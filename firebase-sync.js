// ════════════════════════════════════════
// firebase-sync.js — Firestore sync operations
// ════════════════════════════════════════

async function syncUserToFirestore(updates) {
  if (!fbReady || !curUser?.uid) return;
  try {
    await fbDb.collection('users').doc(curUser.uid).update(updates);
  } catch(e) { console.warn('Sync user error:', e.message); }
}
