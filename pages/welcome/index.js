Page({
  data: {
    entering: false,
    topPadding: 56,
    bottomPadding: 28,
    orbitPanels: [
      {
        id: 'square',
        slot: 'top',
        tag: '问题广场',
        title: '问题正在被看见',
        desc: '新的倾诉落进光里'
      },
      {
        id: 'reply',
        slot: 'right',
        tag: '温柔回应',
        title: '回应会慢慢长出来',
        desc: '老师与同伴都在路上'
      },
      {
        id: 'anonymous',
        slot: 'bottom',
        tag: '匿名倾诉',
        title: '不必先想得很完整',
        desc: '先把心事放下来'
      },
      {
        id: 'companion',
        slot: 'left',
        tag: '陪伴记录',
        title: '每条声音都有回响',
        desc: '在这里被温柔听见'
      }
    ]
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

  onUnload() {
    this.clearEnterTimer();
  },

  clearEnterTimer() {
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
  },

  enterApp() {
    if (this.data.entering) {
      return;
    }

    this.setData({ entering: true });
    this.clearEnterTimer();

    if (wx.vibrateShort) {
      wx.vibrateShort();
    }

    this.enterTimer = setTimeout(() => {
      this.navigateIntoApp();
    }, 1100);
  },

  navigateIntoApp() {
    this.clearEnterTimer();

    const resetEntering = () => {
      this.setData({ entering: false });
    };

    wx.switchTab({
      url: '/pages/index/index',
      fail: () => {
        wx.reLaunch({
          url: '/pages/index/index',
          fail: () => {
            resetEntering();
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
