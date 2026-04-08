Page({
  data: {
    entering: false,
    topPadding: 56,
    bottomPadding: 28,
    orbitPanels: [
      {
        id: 'square',
        slot: 'top',
        tag: '积微成著',
        title: '学不进去怎么办啊',
        desc: '拆解目标先做一题'
      },
      {
        id: 'reply',
        slot: 'right',
        tag: '温言暖语',
        title: '总怕冷场说错话',
        desc: '倾听比表达更重要'
      },
      {
        id: 'anonymous',
        slot: 'bottom',
        tag: '向内生长',
        title: '总觉得自己不够好',
        desc: '接纳自己慢慢变好'
      },
      {
        id: 'companion',
        slot: 'left',
        tag: '向阳而行',
        title: '前路迷茫该往哪走',
        desc: '踏实走好这一步吧'
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
  },

  goToAppointment() {
    if (this.data.entering) {
      return;
    }

    wx.navigateTo({
      url: '/pages/appointment/index'
    });
  }
});
