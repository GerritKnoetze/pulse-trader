#!/usr/bin/env node

import { resolve, join, dirname } from 'path';
import { Command } from 'commander';
import { MigrationManager } from '../database/migration-manager';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';
import * as DatabaseLogger from '../database/database.logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Helpers ─────────────────────────────────────────────────

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((r) => {
    rl.question(question, (answer) => { rl.close(); r(answer); });
  });
}

async function confirm(message: string): Promise<boolean> {
  const answer = await ask(message);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

// ── Bootstrap ───────────────────────────────────────────────

console.log('\nStarting migration CLI...');

const program = new Command();
let migrationManager: MigrationManager;

try {
  console.log('Creating migration manager...\n');
  migrationManager = new MigrationManager(join(__dirname, '../database/migrations'));
  console.log('• Migration manager created successfully\n');
} catch (error) {
  console.error('Failed to create migration manager:', error);
  process.exit(1);
}

program
  .name('migrate')
  .description('Database migration tool for Pulse Trader')
  .version('1.0.0');

// ── up ──────────────────────────────────────────────────────

program
  .command('up')
  .description('Apply pending migrations')
  .argument('[target]', 'Target version to migrate to (optional)')
  .option('-t, --target <version>', 'Target version to migrate to')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (targetArg, options) => {
    try {
      const targetVersion = targetArg || options.target;

      if (options.verbose) {
        console.log(`Target version: ${targetVersion || 'latest'}`);
      }

      // Get migration status
      const status = await migrationManager.getStatus();

      // Display migration summary
      console.log('Migration Summary:');
      console.log(`  Total Available: ${status.totalAvailable}`);
      console.log(`  Applied: ${status.totalApplied}`);
      console.log(`  Pending: ${status.totalPending}`);
      console.log(`  Last Applied: ${status.lastAppliedVersion || 'None'}`);
      console.log('');

      if (status.pendingMigrations.length > 0) {
        console.log('Pending Migrations to Apply:');
        status.pendingMigrations.forEach((m) => {
          console.log(`  • ${m.version}_${m.name}`);
        });
        console.log('');
      } else {
        console.log('• No pending migrations to apply\n');
        process.exit(0);
      }

      // Ask for confirmation before migrating
      const proceed = await confirm('Do you want to proceed with the migration? (y/N): ');

      if (!proceed) {
        console.log('• Migration cancelled by user');
        process.exit(0);
      }

      console.log('\nStarting database migration...\n');

      await migrationManager.migrateUp(targetVersion);
      console.log('---------------------------------------');
      console.log('• Migration completed successfully!');
      console.log('---------------------------------------\n');
      process.exit(0);
    } catch (error) {
      console.log('---------------------------------------');
      console.error('• Migration failed:', error);
      console.log('---------------------------------------\n');
      DatabaseLogger.logError(error as Error, { operation: 'cli_migrate_up' });
      process.exit(1);
    }
  });

// ── down ────────────────────────────────────────────────────

program
  .command('down')
  .description('Rollback to a specific target version')
  .argument('[target]', 'Target version to rollback to (required for down migrations)')
  .option('-t, --target <version>', 'Target version to rollback to')
  .option('-v, --verbose', 'Show detailed output')
  .option('--all', 'Rollback all migrations (complete rollback)')
  .action(async (targetArg, options) => {
    try {
      const targetVersion = targetArg || options.target;
      const isCompleteRollback = options.all || !targetVersion;

      if (!isCompleteRollback && !targetVersion) {
        console.error('• Target version is required for rollback.');
        console.error('Usage: npm run migrate:down "target-version"');
        console.error('   or: npm run migrate:down --target "target-version"');
        console.error('   or: npm run migrate:down --all (for complete rollback)');
        process.exit(1);
      }

      const rollbackMessage = isCompleteRollback
        ? 'Rolling back all migrations (complete rollback)...\n'
        : `Rolling back to version ${targetVersion}...\n`;

      console.log(rollbackMessage);

      const warningMessage = isCompleteRollback
        ? 'WARNING: This will rollback ALL migrations and COMPLETELY REMOVE THE DATABASE. Continue? (y/N): '
        : `WARNING: This will rollback to version ${targetVersion}. Continue? (y/N): `;

      const proceed = await confirm(warningMessage);

      if (!proceed) {
        console.log('• Rollback cancelled by user');
        process.exit(0);
      }

      if (isCompleteRollback) {
        const status = await migrationManager.getStatus();

        if (status.appliedMigrations.length === 0) {
          console.log('• No migrations to rollback - database is already clean');
          process.exit(0);
        }

        console.log(`• Found ${status.appliedMigrations.length} applied migration(s) to rollback`);

        const firstMigration = status.appliedMigrations[0];
        const calculatedTarget = (parseInt(firstMigration.Version) - 1)
          .toString()
          .padStart(firstMigration.Version.length, '0');

        await migrationManager.migrateDown(calculatedTarget);
        console.log('\n• Complete rollback completed successfully! Database is now clean.');
      } else {
        await migrationManager.migrateDown(targetVersion);
        console.log('\n• Rollback completed successfully!');
      }

      process.exit(0);
    } catch (error) {
      console.error('\n• Rollback failed:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_migrate_down' });
      process.exit(1);
    }
  });

// ── status ──────────────────────────────────────────────────

program
  .command('status')
  .description('Show migration status')
  .option('-v, --verbose', 'Show detailed information')
  .option('-s, --summary', 'Show only summary (default)')
  .action(async (options) => {
    try {
      console.log('Migration Status\n');
      const status = await migrationManager.getStatus();

      console.log('Summary:');
      console.log(`  Total Available: ${status.totalAvailable}`);
      console.log(`  Applied: ${status.totalApplied}`);
      console.log(`  Pending: ${status.totalPending}`);
      console.log(`  Last Applied: ${status.lastAppliedVersion || 'None'}\n`);

      if (options.verbose) {
        console.log('Applied Migrations:');
        if (status.appliedMigrations.length === 0) {
          console.log('  No migrations applied yet');
        } else {
          status.appliedMigrations.forEach((m) => {
            console.log(
              `  • ${m.Version}_${m.Name} (${m.AppliedAt.toISOString()}) - ${m.ExecutionTime}ms`,
            );
          });
        }

        console.log('\nPending Migrations:');
        if (status.pendingMigrations.length === 0) {
          console.log('  No pending migrations');
        } else {
          status.pendingMigrations.forEach((m) => {
            console.log(`  • ${m.version}_${m.name}`);
          });
        }
      } else {
        if (status.pendingMigrations.length > 0) {
          console.log('Next Pending Migrations:');
          status.pendingMigrations.slice(0, 5).forEach((m) => {
            console.log(`  • ${m.version}_${m.name}`);
          });
          if (status.pendingMigrations.length > 5) {
            console.log(`  ... and ${status.pendingMigrations.length - 5} more`);
          }
        }
      }

      process.exit(0);
    } catch (error) {
      console.error('• Failed to get status:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_status' });
      process.exit(1);
    }
  });

// ── validate ────────────────────────────────────────────────

program
  .command('validate')
  .description('Validate migration integrity and consistency')
  .option('-v, --verbose', 'Show detailed validation information')
  .action(async (options) => {
    try {
      console.log('Validating migration integrity...\n');
      const result = await migrationManager.validateMigrations();

      if (result.valid) {
        console.log('• All migrations are valid!');
        if (options.verbose) {
          console.log('Validation checks passed:');
          console.log('  • File integrity (checksums)');
          console.log('  • Migration sequence');
          console.log('  • Applied vs Available consistency');
        }
      } else {
        console.log('• Migration validation failed:\n');
        result.issues.forEach((issue) => {
          console.log(`  • ${issue}`);
        });
      }

      process.exit(result.valid ? 0 : 1);
    } catch (error) {
      console.error('• Validation failed:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_validate' });
      process.exit(1);
    }
  });

// ── create ──────────────────────────────────────────────────

program
  .command('create')
  .description('Create a new migration file')
  .argument('[name]', 'Migration name (use kebab-case)')
  .argument('[description]', 'Migration description')
  .option('-n, --name <name>', 'Migration name (use kebab-case)')
  .option('-d, --desc <description>', 'Migration description')
  .action((nameArg, descArg, options) => {
    try {
      const migrationName = nameArg || options.name;
      const description = descArg || options.desc;

      if (!migrationName) {
        console.error('• Migration name is required.');
        console.error('Usage: npm run migrate:create "migration-name" "description"');
        console.error('   or: npm run migrate:create -n "migration-name" -d "description"');
        console.error('\nExamples:');
        console.error('  npm run migrate:create "create-users-table" "Create users table with basic fields"');
        console.error('  npm run migrate:create -n "add-indexes" -d "Add performance indexes"');
        process.exit(1);
      }

      if (!/^[a-z0-9-]+$/.test(migrationName)) {
        console.error('• Migration name must use kebab-case (lowercase letters, numbers, and hyphens only).');
        console.error('Examples: "create-users", "add-user-indexes", "update-schema-v2"');
        process.exit(1);
      }

      if (!description) {
        console.log('• Warning: No description provided. It is recommended to add a description.');
      }

      console.log('Creating new migration...\n');
      console.log('Migration details:');
      console.log(`  Name: ${migrationName}`);
      console.log(`  Description: ${description || 'No description provided'}`);

      const timestamp = new Date().toISOString().replace(/[-:T]/g, '').split('.')[0];
      const migrationsDir = join(__dirname, '../database/migrations');
      if (!existsSync(migrationsDir)) mkdirSync(migrationsDir, { recursive: true });

      const filename = `${timestamp}_${migrationName}.ts`;
      const filepath = join(migrationsDir, filename);

      const content = `import type Database from 'better-sqlite3';
import type { Migration } from '../migration-manager';

/**
 * Migration: ${migrationName}
 * Version: ${timestamp}
 * Description: ${description || 'No description provided'}
 * Created: ${new Date().toISOString()}
 */
const migration: Migration = {
  up(db: Database.Database): void {
    // Add your migration SQL here
    // db.exec(\`
    //   CREATE TABLE example (
    //     Id TEXT PRIMARY KEY,
    //     Name TEXT NOT NULL,
    //     CreatedAt TEXT NOT NULL
    //   )
    // \`);
  },

  down(db: Database.Database): void {
    // Add your rollback SQL here
    // db.exec('DROP TABLE IF EXISTS example');
  },
};

export default migration;
`;

      writeFileSync(filepath, content);
      console.log(`\n• Created migration file: ${filename}`);

      console.log('\n• Migration file created successfully!');
      console.log('\nNext steps:');
      console.log('  1. Edit the migration file to add your up() and down() logic');
      console.log('  2. Run "npm run migrate:up" to apply the migration');
      process.exit(0);
    } catch (error) {
      console.error('• Failed to create migration:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_create' });
      process.exit(1);
    }
  });

// ── list ────────────────────────────────────────────────────

interface MigrationListItem {
  version: string;
  name: string;
  applied: boolean;
  appliedAt?: Date;
  executionTime?: number;
}

program
  .command('list')
  .description('List all available migrations')
  .option('-v, --verbose', 'Show detailed information including descriptions')
  .option('-a, --applied', 'Show only applied migrations')
  .option('-p, --pending', 'Show only pending migrations')
  .action(async (options) => {
    try {
      console.log('Available Migrations\n');
      const status = await migrationManager.getStatus();
      let migrations: MigrationListItem[] = [
        ...status.appliedMigrations.map((m) => ({
          version: m.Version,
          name: m.Name,
          applied: true,
          appliedAt: m.AppliedAt,
          executionTime: m.ExecutionTime,
        })),
        ...status.pendingMigrations.map((m) => ({
          version: m.version,
          name: m.name,
          applied: false,
        })),
      ];

      if (options.applied) {
        migrations = migrations.filter((m) => m.applied);
      } else if (options.pending) {
        migrations = migrations.filter((m) => !m.applied);
      }

      if (migrations.length === 0) {
        const filterText = options.applied ? 'applied' : options.pending ? 'pending' : '';
        console.log(`No ${filterText} migrations found`);
        process.exit(0);
      }

      migrations.forEach((m) => {
        const statusIcon = m.applied ? '[applied]' : '[pending]';
        const appliedInfo = m.applied
          ? ` (Applied: ${m.appliedAt?.toISOString()}, ${m.executionTime}ms)`
          : '';

        console.log(`${statusIcon} - ${m.version}_${m.name}${appliedInfo}`);
      });

      process.exit(0);
    } catch (error) {
      console.error('• Failed to list migrations:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_list' });
      process.exit(1);
    }
  });

// ── reset ───────────────────────────────────────────────────

program
  .command('reset')
  .description('Reset the database (drop and recreate with all migrations)')
  .option('-v, --verbose', 'Show detailed output')
  .option('-f, --force', 'Skip confirmation prompt (use with caution)')
  .action(async (options) => {
    try {
      console.log('Resetting database...\n');

      if (!options.force) {
        const proceed = await confirm('WARNING: This will RESET all migrations. Continue? (y/N): ');
        if (!proceed) {
          console.log('• Reset cancelled by user');
          process.exit(0);
        }
      }

      if (options.verbose) {
        console.log('• Resetting migration history...');
      }

      migrationManager.reset(true);

      if (options.verbose) {
        console.log('• Applying all migrations...');
      }

      await migrationManager.migrateUp();

      console.log('\n• Database reset completed successfully!');
      console.log('• All migrations have been applied to the fresh database.');
      process.exit(0);
    } catch (error) {
      console.error('\n• Reset failed:', error);
      DatabaseLogger.logError(error as Error, { operation: 'cli_reset' });
      process.exit(1);
    }
  });

program.parse();
