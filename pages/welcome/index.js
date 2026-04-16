const app = getApp();

Page({
  data: {
    entering: false,
    checkingLogin: true,
    isLoggedIn: false,
    showLoginGate: false,
    loginLoading: false,
    hasAdminInviteToken: false,
    hasTeacherInviteToken: false,
    adminInviteClaiming: false,
    nickName: '',
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

  onLoad(options) {
    if (wx.hideHomeButton) {
      wx.hideHomeButton();
    }

    this.pendingAdminInviteToken = ((options || {}).adminInviteToken || '').trim();
    this.pendingTeacherInviteToken = ((options || {}).teacherInviteToken || '').trim();

    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const safeArea = windowInfo.safeArea || {};
    const screenHeight = windowInfo.screenHeight || windowInfo.windowHeight || 0;
    const topPadding = Math.max((safeArea.top || windowInfo.statusBarHeight || 0) + 24, 56);
    const bottomInset = screenHeight && safeArea.bottom ? screenHeight - safeArea.bottom : 0;
    const bottomPadding = Math.max(bottomInset + 28, 28);

    this.setData({
      topPadding,
      bottomPadding,
      hasAdminInviteToken: !!this.pendingAdminInviteToken,
      hasTeacherInviteToken: !!this.pendingTeacherInviteToken
    });
  },

  onShow() {
    this.syncLoginGate();
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

  noop() {},

  applyLoggedOutState(preservedNickName = '') {
    this.clearEnterTimer();
    this.setData({
      entering: false,
      checkingLogin: false,
      isLoggedIn: false,
      showLoginGate: true,
      loginLoading: false,
      nickName: preservedNickName
    });
    return null;
  },

  syncLoginGate() {
    const cachedUserInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    const preservedNickName = (this.data.nickName || cachedUserInfo.nickName || cachedUserInfo.nickname || '').trim();

    this.setData({ checkingLogin: true });

    const handleLoggedOut = () => {
      if (typeof app.clearLoginState === 'function') {
        app.clearLoginState();
      }
      return this.applyLoggedOutState(preservedNickName);
    };

    const token = wx.getStorageSync('token');
    if (!token) {
      return Promise.resolve(handleLoggedOut());
    }

    const syncTask = typeof app.syncSession === 'function'
      ? app.syncSession()
      : (typeof app.fetchCurrentUser === 'function' ? app.fetchCurrentUser() : Promise.resolve(app.globalData.userInfo));

    return Promise.resolve(syncTask).then((latestUserInfo) => {
      if (!latestUserInfo) {
        return handleLoggedOut();
      }

      const userInfo = typeof app.normalizeUserInfo === 'function'
        ? app.normalizeUserInfo(latestUserInfo)
        : latestUserInfo;

      this.setData({
        checkingLogin: false,
        isLoggedIn: true,
        showLoginGate: false,
        loginLoading: false,
        nickName: userInfo?.nickName || userInfo?.nickname || preservedNickName
      });

      return this.claimPendingInvites(userInfo);
    }).catch(() => {
      const latestToken = wx.getStorageSync('token');
      const fallbackUserInfo = typeof app.normalizeUserInfo === 'function'
        ? app.normalizeUserInfo(app.globalData.userInfo)
        : app.globalData.userInfo;

      if (!latestToken || !fallbackUserInfo) {
        return handleLoggedOut();
      }

      this.setData({
        checkingLogin: false,
        isLoggedIn: true,
        showLoginGate: false,
        loginLoading: false,
        nickName: fallbackUserInfo.nickName || fallbackUserInfo.nickname || preservedNickName
      });

      return this.claimPendingInvites(fallbackUserInfo);
    });
  },

  claimPendingInvites(userInfo) {
    return this.claimAdminInviteIfNeeded(userInfo).then((nextUserInfo) => {
      return this.claimTeacherInviteIfNeeded(nextUserInfo);
    });
  },

  claimAdminInviteIfNeeded(userInfo) {
    const inviteToken = (this.pendingAdminInviteToken || '').trim();
    const token = wx.getStorageSync('token');

    if (!inviteToken || !token || this.data.adminInviteClaiming) {
      return Promise.resolve(userInfo);
    }

    this.setData({ adminInviteClaiming: true });

    return new Promise((resolve) => {
      wx.request({
        url: `${app.globalData.baseUrl}/admin/invitations/claim`,
        method: 'POST',
        header: { Authorization: token },
        data: { token: inviteToken },
        success: (res) => {
          this.setData({ adminInviteClaiming: false });

          if (res.statusCode === 200 && res.data?.success) {
            const latestUserInfo = typeof app.normalizeUserInfo === 'function'
              ? app.normalizeUserInfo(res.data.userInfo || userInfo)
              : (res.data.userInfo || userInfo);

            app.globalData.userInfo = latestUserInfo;
            app.globalData.isLoggedIn = true;
            wx.setStorageSync('userInfo', latestUserInfo);
            if (typeof app.refreshTeacherNotificationBadge === 'function') {
              app.refreshTeacherNotificationBadge();
            }

            this.pendingAdminInviteToken = '';
            this.setData({ hasAdminInviteToken: false });

            if (!res.data.alreadyClaimed) {
              wx.showToast({
                title: '已开通管理员权限',
                icon: 'success'
              });
            }

            resolve(latestUserInfo);
            return;
          }

          if (res.statusCode >= 400) {
            this.pendingAdminInviteToken = '';
            this.setData({ hasAdminInviteToken: false });
            wx.showToast({
              title: res.data?.error || '管理员邀请已失效',
              icon: 'none'
            });
          }

          resolve(userInfo);
        },
        fail: () => {
          this.setData({ adminInviteClaiming: false });
          resolve(userInfo);
        }
      });
    });
  },

  claimTeacherInviteIfNeeded(userInfo) {
    const inviteToken = (this.pendingTeacherInviteToken || '').trim();
    const token = wx.getStorageSync('token');

    if (!inviteToken || !token) {
      return Promise.resolve(userInfo);
    }

    return new Promise((resolve) => {
      wx.request({
        url: `${app.globalData.baseUrl}/teacher/invitations/claim`,
        method: 'POST',
        header: { Authorization: token },
        data: { token: inviteToken },
        success: (res) => {
          if (res.statusCode === 200 && res.data?.success) {
            const latestUserInfo = typeof app.normalizeUserInfo === 'function'
              ? app.normalizeUserInfo(res.data.userInfo || userInfo)
              : (res.data.userInfo || userInfo);

            app.globalData.userInfo = latestUserInfo;
            app.globalData.isLoggedIn = true;
            wx.setStorageSync('userInfo', latestUserInfo);
            if (typeof app.refreshTeacherNotificationBadge === 'function') {
              app.refreshTeacherNotificationBadge();
            }

            this.pendingTeacherInviteToken = '';
            this.setData({ hasTeacherInviteToken: false });

            if (!res.data.alreadyClaimed) {
              wx.showToast({
                title: '已开通教师身份',
                icon: 'success'
              });
            }

            resolve(latestUserInfo);
            return;
          }

          if (res.statusCode >= 400) {
            this.pendingTeacherInviteToken = '';
            this.setData({ hasTeacherInviteToken: false });
            wx.showToast({
              title: res.data?.error || '教师邀请已失效',
              icon: 'none'
            });
          }

          resolve(userInfo);
        },
        fail: () => {
          resolve(userInfo);
        }
      });
    });
  },

  onNicknameInput(e) {
    this.setData({
      nickName: e.detail.value
    });
  },

  startLogin() {
    const nickName = (this.data.nickName || '').trim();
    const hasPendingAdminInvite = !!(this.pendingAdminInviteToken || '').trim();
    const hasPendingTeacherInvite = !!(this.pendingTeacherInviteToken || '').trim();
    if (!nickName) {
      wx.showToast({
        title: '请先输入昵称',
        icon: 'none'
      });
      return;
    }

    if (this.data.loginLoading) {
      return;
    }

    this.setData({ loginLoading: true });
    wx.showLoading({ title: '登录中...' });

    app.login({ nickName }).then((latestUserInfo) => {
      wx.hideLoading();
      const userInfo = typeof app.normalizeUserInfo === 'function'
        ? app.normalizeUserInfo(latestUserInfo)
        : latestUserInfo;

      this.setData({
        checkingLogin: false,
        isLoggedIn: true,
        showLoginGate: false,
        loginLoading: false,
        nickName: userInfo?.nickName || nickName
      });

      this.claimPendingInvites(userInfo).then(() => {
        if (!hasPendingAdminInvite && !hasPendingTeacherInvite) {
          wx.showToast({
            title: '登录成功',
            icon: 'success'
          });
        }
      });
    }).catch((error) => {
      wx.hideLoading();
      this.setData({
        checkingLogin: false,
        isLoggedIn: false,
        showLoginGate: true,
        loginLoading: false
      });
      wx.showToast({
        title: error?.message || error || '登录失败',
        icon: 'none'
      });
    });
  },

  ensureLoggedInBeforeEnter() {
    if (!this.data.isLoggedIn || this.data.checkingLogin || this.data.loginLoading) {
      wx.showToast({
        title: '请先完成登录',
        icon: 'none'
      });
      return false;
    }

    return true;
  },

  enterApp() {
    if (!this.ensureLoggedInBeforeEnter()) {
      return;
    }

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
      url: '/pages/post/select_counselor',
      fail: () => {
        wx.reLaunch({
          url: '/pages/post/select_counselor',
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
    if (!this.ensureLoggedInBeforeEnter()) {
      return;
    }

    if (this.data.entering) {
      return;
    }

    wx.navigateTo({
      url: '/pages/appointment/index'
    });
  }
});
