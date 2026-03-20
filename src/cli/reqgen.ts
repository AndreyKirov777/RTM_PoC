#!/usr/bin/env node
import { Command } from 'commander';
import { ReqgenGenerator } from '../generator/reqgen-generator.js';

const program = new Command();

program
  .name('reqgen')
  .description('Generate realistic spec repositories for testing the sync pipeline')
  .version('0.1.0')
  .requiredOption('--output <path>', 'Output path for the generated repository')
  .option('--epics <n>', 'Number of epics', '3')
  .option('--stories-per-epic <n>', 'User stories per epic', '2')
  .option('--enablers-per-epic <n>', 'Enablers per epic', '1')
  .option('--reqs-per-story <n>', 'Functional requirements per user story', '2')
  .option('--cross-cutting <n>', 'Total cross-cutting artifacts', '5')
  .option('--evals-per-req <n>', 'Evaluation scenarios per FR', '1')
  .option('--milestones <n>', 'Number of milestones', '2')
  .option('--releases <n>', 'Number of releases', '2')
  .option('--seed <n>', 'RNG seed for deterministic output')
  .option('--no-git-history', 'Skip creating git history (default: create history)')
  .option('--malformed <n>', 'Number of malformed files to inject', '0')
  .action(async (opts: {
    output: string;
    epics: string;
    storiesPerEpic: string;
    enablersPerEpic: string;
    reqsPerStory: string;
    crossCutting: string;
    evalsPerReq: string;
    milestones: string;
    releases: string;
    seed?: string;
    gitHistory: boolean;
    malformed: string;
  }) => {
    const generator = new ReqgenGenerator();
    try {
      const result = await generator.generate({
        outputPath: opts.output,
        epics: parseInt(opts.epics, 10),
        storiesPerEpic: parseInt(opts.storiesPerEpic, 10),
        enablersPerEpic: parseInt(opts.enablersPerEpic, 10),
        reqsPerStory: parseInt(opts.reqsPerStory, 10),
        crossCutting: parseInt(opts.crossCutting, 10),
        evalsPerReq: parseInt(opts.evalsPerReq, 10),
        milestones: parseInt(opts.milestones, 10),
        releases: parseInt(opts.releases, 10),
        seed: opts.seed ? parseInt(opts.seed, 10) : null,
        gitHistory: opts.gitHistory,
        malformed: parseInt(opts.malformed, 10),
      });

      console.log(`Generated repository at: ${result.outputPath}`);
      console.log(`  Total files:     ${result.totalFiles}`);
      console.log(`  Malformed files: ${result.malformedFiles}`);
      console.log('  Artifact counts:');
      for (const [type, count] of Object.entries(result.artifactCounts)) {
        if (count > 0) console.log(`    ${type}: ${count}`);
      }
    } catch (e) {
      console.error('Generation failed:', e);
      process.exit(1);
    }
  });

program.parse();
