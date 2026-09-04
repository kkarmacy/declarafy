// ════════════════════════════════════════
// push-notifications.js — FCM Push Notifications
// ════════════════════════════════════════

let fcmMessaging = null;

function tpInitFCM() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

  const script = document.createElement('script');
  script.src = 'https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js';
  script.onload = () => {
    try {
      fcmMessaging = firebase.messaging();
      fcmMessaging.onMessage(payload => {
        const { title, body } = payload.notification || {};
        if (title) {
          tpToast(`🔔 ${title}: ${body || ''}`, 'info');
          addNotif(payload.notification?.icon || '🔔', title, body || '');
        }
      });
      tpRequestPushPermission();
    } catch(e) { console.warn('FCM init error:', e.message); }
  };
  document.head.appendChild(script);
}

async function tpRequestPushPermission() {
  if (!fcmMessaging) return;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const token = await fcmMessaging.getToken({
      vapidKey: 'y5FOKXV3UVDFVsHkySoSFEu7oYheTx75qW18eGO4dGc'
    });

    if (token) {
      if (fbReady && curUser?.uid) {
        try {
          await fbDb.collection('users').doc(curUser.uid).update({ pushToken: token });
        } catch(e) { console.warn('Save push token error:', e.message); }
      }
    }
  } catch(e) { console.warn('FCM permission error:', e.message); }
}
