Page({
  data: {
    entering: false,
    topPadding: 56,
    bottomPadding: 28
  },

  onLoad() {
    if (wx.hideHomeButton) {
      wx.hideHomeButton();
    }

    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const safeArea = windowInfo.safeArea || {};
    const screenHeight = windowInfo.screenHeight || windowInfo.windowHeight || 0;
    const topPadding = Math.max((safeArea.top || windowInfo.statusBarHeight || 0) + 24, 56);
    const bottomInset = screenHeight && safeArea.bottom ? screenHeight - safeArea.bottom : 0;
    const bottomPadding = Math.max(bottomInset + 28, 28);

    this.setData({
      topPadding,
      bottomPadding
    });
  },

  enterApp() {
    if (this.data.entering) {
      return;
    }

    this.setData({ entering: true });

    if (wx.vibrateShort) {
      wx.vibrateShort();
    }

    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {
        wx.reLaunch({
          url: '/pages/index/index',
          fail: () => {
            this.setData({ entering: false });
            wx.showToast({
              title: '进入失败，请重试',
              icon: 'none'
            });
          }
        });
      }
    });
  }
});
