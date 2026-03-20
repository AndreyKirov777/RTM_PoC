import simpleGit from 'simple-git';
import type { StagedCommits, CommitLog } from '../types.js';

export class GitHistoryBuilder {
  async buildHistory(repoPath: string, staged: StagedCommits): Promise<CommitLog> {
    const git = simpleGit(repoPath);
    await git.init();

    // Configure dummy identity for generated repo
    await git.addConfig('user.email', 'reqgen@localhost');
    await git.addConfig('user.name', 'reqgen');

    const commits: CommitLog['commits'] = [];

    async function commit(message: string, files: string[]): Promise<void> {
      if (files.length === 0) return;
      await git.add(files);
      const sha = await git.commit(message);
      commits.push({ sha: sha.commit, message, files: files.length });
    }

    // 1. Scaffold commit
    if (staged.scaffold.length > 0) {
      await commit('chore: scaffold repository structure', staged.scaffold);
    }

    // 2. Epic commits
    for (const [epicId, files] of staged.epicCommits) {
      await commit(`feat: add ${epicId} and related artifacts`, files);
    }

    // 3. Requirements commit
    if (staged.requirements.length > 0) {
      await commit('feat: add functional and non-functional requirements', staged.requirements);
    }

    // 4. Cross-cutting artifacts
    if (staged.crossCutting.length > 0) {
      await commit('feat: add cross-cutting artifacts (UC, ENT, ADR, etc.)', staged.crossCutting);
    }

    // 5. Verification / evals
    if (staged.verification.length > 0) {
      await commit('feat: add verification scenarios', staged.verification);
    }

    // 6. Modifications
    if (staged.modifications.length > 0) {
      for (const mod of staged.modifications) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(mod.path, mod.content, 'utf8');
      }
      await commit('fix: update selected artifacts', staged.modifications.map(m => m.path));
    }

    // 7. Deletions
    if (staged.deletions.length > 0) {
      await git.rm(staged.deletions);
      await commit('chore: remove deprecated artifacts', staged.deletions);
    }

    // 8. Malformed files
    if (staged.malformed.length > 0) {
      await commit('test: inject malformed artifact files', staged.malformed);
    }

    return { commits };
  }
}
