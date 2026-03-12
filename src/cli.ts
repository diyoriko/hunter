/**
 * CLI entry point for one-off commands.
 * Usage: ts-node src/cli.ts <command>
 */
import { getDb } from './db';
import { runAllScrapers } from './scrapers/runner';
import { buildDigest, buildTop, buildStatsMessage } from './digest';
import { logger } from './logger';

const command = process.argv[2];

async function main() {
  getDb(); // init

  switch (command) {
    case 'scrape': {
      logger.info('cli', 'Running manual scrape...');
      const results = await runAllScrapers();
      for (const r of results) {
        console.log(`${r.source}: found=${r.found}, new=${r.new}, topScore=${r.topScore}`);
        if (r.errors.length > 0) {
          console.log(`  Errors: ${r.errors.join(', ')}`);
        }
      }
      break;
    }

    case 'digest': {
      const { text } = buildDigest();
      // Strip HTML for console
      console.log(text.replace(/<[^>]+>/g, ''));
      break;
    }

    case 'top': {
      const text = buildTop(30);
      console.log(text.replace(/<[^>]+>/g, ''));
      break;
    }

    case 'stats': {
      const text = buildStatsMessage();
      console.log(text.replace(/<[^>]+>/g, ''));
      break;
    }

    default:
      console.log('Usage: ts-node src/cli.ts <scrape|digest|top|stats>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
