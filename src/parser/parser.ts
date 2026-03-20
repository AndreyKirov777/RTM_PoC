import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';
import type { Root, Heading } from 'mdast';
import {
  type ParsedArtifact,
  type ParseError,
  type ArtifactLink,
  type ArtifactType,
  type Result,
  Ok,
  Err,
  PREFIX_TO_TYPE,
} from '../types.js';

// Matches PREFIX-NNN artifact ID references
const REF_PATTERN =
  /\b(EPIC|US|EN|FR|NFR|BR|UC|ENT|API|SCR|ADR|EV|AB|RB|MS|REL)-\d{3,}\b/g;

// Sections from which we extract artifact links
const LINK_SECTION_KEYWORDS = ['tracea', 'link', 'depend', 'related', 'reference', 'verif'];

export class MarkdownParser {
  private readonly processor = unified().use(remarkParse);

  parseArtifact(filePath: string, content: string): Result<ParsedArtifact, ParseError> {
    const tree = this.processor.parse(content) as Root;

    // 1. Extract H1 title
    const title = this.extractTitle(tree);
    if (title === null) {
      return Err({ filePath, message: 'No H1 heading found', line: null });
    }

    // 2. Extract H2 sections as raw markdown slices
    const sections = this.extractSections(tree, content);

    // 3. Parse Identification section
    const identText = sections.get('Identification');
    if (!identText) {
      return Err({ filePath, message: 'No Identification section found', line: null });
    }

    const identification = this.parseKeyValueBlock(identText);
    const stableId = identification['Stable ID'] ?? identification['ID'] ?? null;
    if (!stableId) {
      return Err({ filePath, message: 'No Stable ID in Identification section', line: null });
    }

    // 4. Infer artifact type from stable ID prefix
    const prefix = stableId.split('-')[0] ?? '';
    const artifactType: ArtifactType | undefined = PREFIX_TO_TYPE[prefix];
    if (!artifactType) {
      return Err({
        filePath,
        message: `Unknown artifact type prefix: "${prefix}" in stable ID "${stableId}"`,
        line: null,
      });
    }

    // 5. Parse Metadata section
    const metaText = sections.get('Metadata') ?? '';
    const metaKv = this.parseKeyValueBlock(metaText);

    const status = metaKv['Status'] ?? null;
    const owner = metaKv['Owner'] ?? null;
    const priority = metaKv['Priority'] ?? null;

    // Remaining metadata fields
    const knownMetaKeys = new Set(['Status', 'Owner', 'Priority']);
    const metadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(metaKv)) {
      if (!knownMetaKeys.has(k)) metadata[k] = v;
    }

    // 6. Inline acceptance criteria (Req 9.3)
    const acText = sections.get('Acceptance Criteria');
    if (acText) {
      metadata['acceptanceCriteria'] = acText.trim();
    }

    // 7. Extract artifact ID links from link-oriented sections
    const links = this.extractLinks(sections);

    return Ok({
      stableId,
      artifactType,
      title,
      hierarchyNumber: identification['Hierarchy Number'] ?? null,
      parentStableId: identification['Parent'] ?? null,
      status,
      owner,
      priority,
      metadata,
      bodyMarkdown: content,
      sections,
      links,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────

  private extractTitle(tree: Root): string | null {
    for (const node of tree.children) {
      if (node.type === 'heading' && (node as Heading).depth === 1) {
        return toString(node).trim();
      }
    }
    return null;
  }

  /**
   * Slice the original `content` into H2 sections.
   * Returns Map<sectionName, rawMarkdownContent>.
   * Uses node positions so the raw `**bold**` markers are preserved.
   */
  private extractSections(tree: Root, content: string): Map<string, string> {
    const sections = new Map<string, string>();
    const nodes = tree.children;

    let currentSection: string | null = null;
    let sectionContentStart = 0;

    for (const node of nodes) {
      if (node.type === 'heading' && (node as Heading).depth === 2) {
        // Flush the previous section
        if (currentSection !== null) {
          const rawSlice = content.slice(
            sectionContentStart,
            node.position?.start.offset ?? content.length,
          );
          sections.set(currentSection, rawSlice.trim());
        }
        currentSection = toString(node).trim();
        sectionContentStart = node.position?.end.offset ?? 0;
      }
    }

    // Flush last section
    if (currentSection !== null) {
      sections.set(currentSection, content.slice(sectionContentStart).trim());
    }

    return sections;
  }

  /**
   * Parse `- **Key**: Value` lines from a raw markdown section.
   * Also handles `- *Key*: Value` and `- Key: Value`.
   */
  private parseKeyValueBlock(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split('\n')) {
      // Match:  - **Key**: Value  |  - *Key*: Value  |  - Key: Value
      const match = line.match(/^\s*[-*]\s+\**([^*:\n]+)\**:\s*(.+)/);
      if (match) {
        const key = (match[1] ?? '').trim();
        const value = (match[2] ?? '').trim();
        if (key) result[key] = value;
      }
    }
    return result;
  }

  /**
   * Extract artifact ID references from link-oriented sections.
   * Looks for `- **Link type**: REF-001, REF-002` patterns.
   */
  private extractLinks(sections: Map<string, string>): ArtifactLink[] {
    const links: ArtifactLink[] = [];

    for (const [sectionName, sectionText] of sections) {
      const nameLower = sectionName.toLowerCase();
      const isLinkSection = LINK_SECTION_KEYWORDS.some(kw => nameLower.includes(kw));
      if (!isLinkSection) continue;

      for (const line of sectionText.split('\n')) {
        // Try `- **Link type**: REF-001, REF-002`
        const itemMatch = line.match(/^\s*[-*]\s+\**([^*:\n]+)\**:\s*(.+)/);
        if (itemMatch) {
          const linkType = (itemMatch[1] ?? '').trim();
          const refsText = itemMatch[2] ?? '';
          for (const ref of refsText.matchAll(REF_PATTERN)) {
            const targetId = ref[0];
            if (!links.some(l => l.targetId === targetId && l.linkType === linkType)) {
              links.push({ targetId, linkType, section: sectionName });
            }
          }
        } else {
          // Bare references on any line in the section
          for (const ref of line.matchAll(REF_PATTERN)) {
            const targetId = ref[0];
            if (!links.some(l => l.targetId === targetId && l.section === sectionName)) {
              links.push({ targetId, linkType: sectionName, section: sectionName });
            }
          }
        }
      }
    }

    return links;
  }
}
