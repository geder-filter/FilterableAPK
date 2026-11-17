(() => {
  "use strict";
  try {
    window.WPPConfig = Object.assign({
      disableGoogleAnalytics: true,
      sendStatusToDevice: false,
      syncAllStatus: false
    }, window.WPPConfig || {});
  } catch (e) {}
})();
