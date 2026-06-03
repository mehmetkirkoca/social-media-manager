/**
 * Workspace-aware credential lookup.
 * Tries `${workspaceId}:${type}` first, falls back to bare `${type}` for
 * backwards compatibility with pre-migration documents.
 */
async function getWorkspaceCredential(db, type, workspaceId = 'default') {
  const scoped = await db.collection('platform_credentials').findOne({ _id: `${workspaceId}:${type}` });
  if (scoped) return scoped;
  return db.collection('platform_credentials').findOne({ _id: type });
}

module.exports = { getWorkspaceCredential };
