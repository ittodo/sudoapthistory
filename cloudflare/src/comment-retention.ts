export const MODERATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const moderationCutoff = (time = Date.now()) => new Date(time - MODERATION_RETENTION_MS).toISOString();

// Keep moderated_at as a visibility tombstone: deleting a hidden parent must not expose its replies.
export async function purgeExpiredComments(db: D1Database, time = Date.now()) {
 const cutoff = moderationCutoff(time), deleted = new Date(time).toISOString();
 const targets = 'SELECT id FROM comments WHERE deleted_at IS NULL AND moderated_at<=? ORDER BY moderated_at,id LIMIT 1000';
 await db.batch([
  db.prepare(`DELETE FROM comment_likes WHERE comment_id IN (${targets})`).bind(cutoff),
  db.prepare(`UPDATE comments SET content='',user_id=NULL,request_key=NULL,request_hash=NULL,moderation_reason=NULL,updated_at=NULL,deleted_at=? WHERE id IN (${targets})`).bind(deleted,cutoff)
 ]);
}
