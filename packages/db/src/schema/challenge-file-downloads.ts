import {
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

export const challengeFileDownloads = pgTable(
  'challenge_file_downloads',
  {
    userId: text('user_id').notNull(),
    challengeId: text('challenge_id').notNull(),

    firstDownloadedAt: timestamp('first_downloaded_at', {
      withTimezone: true,
      mode: 'string',
    })
      .defaultNow()
      .notNull(),
  },
  table => [
    primaryKey({
      columns: [table.userId, table.challengeId],
    }),
  ]
)
