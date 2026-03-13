// pages/profile/profile.js
const app = getApp()

function normalizeUserInfo(userInfo) {
  if (!userInfo) {
    return { nickName: '微信用户', avatarUrl: '', role: 'student' };
  }

  return {
    ...userInfo,
    nickName: userInfo.nickName || userInfo.nickname || '微信用户',
    avatarUrl: userInfo.avatarUrl || userInfo.avatar_url || '',
    role: userInfo.role || 'student'
  };
}

function buildEntry(profile) {
  return {
    kind: profile?.kind || 'teacher',
    id: profile?.id || null,
    nickName: profile?.nickName || '',
    avatarUrl: profile?.avatarUrl || '',
    desc: profile?.desc || '',
    isActive: profile?.isActive !== false,
    inviteCode: profile?.inviteCode || '',
    claimed: !!profile?.claimed
  };
}

Page({
  data: {
    userInfo: {},
    hasUserInfo: false,
    myQuestions: [],
    myReplies: [],
    teacherStats: {
      pendingCount: 0,
      todayCount: 0,
      inboxCount: 0,
      squareCount: 0
    },
    teacherQuestions: [],
    teacherViewScope: 'pending',
    teacherViewTitle: '待回复',
    showTeacherQuestions: false,
    teacherLoading: false,
    teacherInviteCode: '',
    showTeacherUpgrade: false,
    exportFilePath: '',
    exportFileName: '',
    showExportActions: false,
    showMyQuestions: false,
    showMyReplies: false
  },

  onLoad() {
    this.setData({
      userInfo: normalizeUserInfo(app.globalData.userInfo)
    });
  },

  onShow() {
    // 每次显示页面时更新用户信息（可能在其他地方修改了）
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: normalizeUserInfo(app.globalData.userInfo)
      });
    }
    
    // 如果已登录，加载数据
    if (app.globalData.isLoggedIn) {
      this.getMyQuestions();
      this.getMyReplies();
      if (this.data.userInfo.role === 'teacher') {
        this.loadTeacherDashboard();
        if (this.data.showTeacherQuestions) {
          this.loadTeacherQuestions(this.data.teacherViewScope, this.data.teacherViewTitle);
        }
        this.markTeacherNotificationsRead();
      }
    }
  },

  // --- 头像昵称修改 ---
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    });
    // 同步到全局
    app.globalData.userInfo = { ...app.globalData.userInfo, avatarUrl };
    this.updateUserProfile();
  },

  onNicknameChange(e) {
    const nickName = e.detail.value;
    this.setData({
      'userInfo.nickName': nickName
    });
  },
  
  onNicknameBlur(e) {
      const nickName = (e.detail.value || '').trim();
      const currentNickName = normalizeUserInfo(app.globalData.userInfo).nickName;

      this.setData({
        'userInfo.nickName': nickName || currentNickName
      });

      if (nickName && nickName !== currentNickName) {
        this.updateUserProfile();
      }
  },

  updateUserProfile() {
      const token = wx.getStorageSync('token');
      if (!token) {
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        });
        return;
      }

      const payload = {
        nickName: (this.data.userInfo.nickName || '').trim(),
        avatarUrl: this.data.userInfo.avatarUrl || ''
      };

      wx.request({
        url: `${app.globalData.baseUrl}/me/profile`,
        method: 'PUT',
        header: {
          'Authorization': token
        },
        data: payload,
        success: (res) => {
          if (res.statusCode === 200 && res.data.success) {
            const userInfo = normalizeUserInfo(res.data.userInfo);
            this.setData({ userInfo });
            app.globalData.userInfo = userInfo;
            wx.setStorageSync('userInfo', userInfo);
            wx.showToast({
              title: '更新成功',
              icon: 'success'
            });
            return;
          }

          wx.showToast({
            title: res.data?.error || '更新失败',
            icon: 'none'
          });
        },
        fail: () => {
          wx.showToast({
            title: '网络错误，请稍后重试',
            icon: 'none'
          });
        }
      });
  },

  // --- 列表展示 ---
  toggleMyQuestions() {
    this.setData({
      showMyQuestions: !this.data.showMyQuestions
    });
    if (this.data.showMyQuestions && this.data.myQuestions.length === 0) {
        this.getMyQuestions();
    }
  },

  toggleTeacherUpgrade() {
    this.setData({
      showTeacherUpgrade: !this.data.showTeacherUpgrade
    });
  },

  onTeacherInviteCodeInput(e) {
    this.setData({
      teacherInviteCode: e.detail.value
    });
  },

  activateTeacherRole() {
    const token = wx.getStorageSync('token');
    const inviteCode = (this.data.teacherInviteCode || '').trim();

    if (!token) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    if (!inviteCode) {
      wx.showToast({
        title: '请输入邀请码',
        icon: 'none'
      });
      return;
    }

    wx.request({
      url: `${app.globalData.baseUrl}/me/role`,
      method: 'POST',
      header: {
        'Authorization': token
      },
      data: {
        inviteCode
      },
      success: (res) => {
        if (res.statusCode === 200 && res.data.success) {
          const userInfo = normalizeUserInfo(res.data.userInfo);
          app.globalData.userInfo = userInfo;
          wx.setStorageSync('userInfo', userInfo);
          this.setData({
            userInfo,
            teacherInviteCode: '',
            showTeacherUpgrade: false
          });
          this.loadTeacherDashboard();
          wx.showToast({
            title: '已切换为教师',
            icon: 'success'
          });
          return;
        }

        wx.showToast({
          title: res.data?.error || '激活失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '网络错误，请稍后重试',
          icon: 'none'
        });
      }
    });
  },

  toggleMyReplies() {
    this.setData({
      showMyReplies: !this.data.showMyReplies
    });
    if (this.data.showMyReplies && this.data.myReplies.length === 0) {
        this.getMyReplies();
    }
  },

  getMyQuestions() {
    wx.request({
      url: `${app.globalData.baseUrl}/my/questions`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ myQuestions: res.data || [] });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载提问失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '提问记录加载失败',
          icon: 'none'
        });
      }
    });
  },

  getMyReplies() {
    wx.request({
      url: `${app.globalData.baseUrl}/my/replies`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          const myReplies = (res.data || []).map((item) => ({
            ...item,
            content: item.content || item.my_reply || ''
          }));
          this.setData({ myReplies });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载回复失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '回复记录加载失败',
          icon: 'none'
        });
      }
    });
  },

  loadTeacherDashboard() {
    wx.request({
      url: `${app.globalData.baseUrl}/teacher/dashboard`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          this.setData({ teacherStats: res.data || this.data.teacherStats });
          app.refreshTeacherNotificationBadge();
          return;
        }

        wx.showToast({
          title: res.data?.error || '教师数据加载失败',
          icon: 'none'
        });
      }
    });
  },

  openTeacherScope(e) {
    const { scope, title } = e.currentTarget.dataset;
    this.loadTeacherQuestions(scope, title);
  },

  loadTeacherQuestions(scope, title) {
    this.setData({
      teacherViewScope: scope,
      teacherViewTitle: title,
      showTeacherQuestions: true,
      teacherLoading: true
    });

    wx.request({
      url: `${app.globalData.baseUrl}/teacher/questions`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      data: { scope },
      success: (res) => {
        this.setData({ teacherLoading: false });
        if (res.statusCode === 200) {
          this.setData({ teacherQuestions: res.data || [] });
          this.markTeacherNotificationsRead();
          return;
        }

        wx.showToast({
          title: res.data?.error || '教师列表加载失败',
          icon: 'none'
        });
      },
      fail: () => {
        this.setData({ teacherLoading: false });
        wx.showToast({
          title: '教师列表加载失败',
          icon: 'none'
        });
      }
    });
  },

  goToDetail(e) {
      // 如果需要跳转到详情页
      const id = e.currentTarget.dataset.id;
      // 这里的逻辑可以复用 index 页面的详情展示，或者跳转到一个独立的详情页
      // 目前简单提示
      wx.showToast({
          title: '查看详情: ' + id,
          icon: 'none'
      });
  },

  showInbox() {
    this.loadTeacherQuestions('inbox', '树洞信箱');
  },

  markTeacherNotificationsRead() {
    wx.request({
      url: `${app.globalData.baseUrl}/teacher/notifications/read`,
      method: 'POST',
      header: { 'Authorization': wx.getStorageSync('token') },
      complete: () => {
        app.refreshTeacherNotificationBadge();
      }
    });
  },

  showSquareManager() {
    wx.navigateTo({
      url: '/pages/teacher/square_manage/index'
    });
  },

  showCounselorManager() {
    wx.navigateTo({
      url: '/pages/teacher/counselor_manage/index'
    });
  },

  exportData() {
    const scope = this.data.teacherViewScope || 'all';
    const token = wx.getStorageSync('token');

    wx.showLoading({ title: '导出中...' });
    wx.downloadFile({
      url: `${app.globalData.baseUrl}/teacher/export?scope=${scope}`,
      header: {
        'Authorization': token
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.saveFile({
            tempFilePath: res.tempFilePath,
            success: (saveRes) => {
              this.setData({
                exportFilePath: saveRes.savedFilePath,
                exportFileName: `secretbox-${scope}.xls`,
                showExportActions: true
              });
            },
            fail: () => {
              this.setData({
                exportFilePath: res.tempFilePath,
                exportFileName: `secretbox-${scope}.xls`,
                showExportActions: true
              });
            }
          });
          return;
        }

        wx.showToast({
          title: '导出失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({
          title: '导出失败',
          icon: 'none'
        });
      }
    });
  },

  previewExportFile() {
    if (!this.data.exportFilePath) {
      return;
    }

    wx.openDocument({
      filePath: this.data.exportFilePath,
      fileType: 'xls',
      showMenu: true,
      fail: () => {
        wx.showToast({
          title: '当前环境无法预览，请在真机中打开',
          icon: 'none'
        });
      }
    });
  },

  shareExportFile() {
    if (!this.data.exportFilePath) {
      return;
    }

    if (typeof wx.shareFileMessage === 'function') {
      wx.shareFileMessage({
        filePath: this.data.exportFilePath,
        fileName: this.data.exportFileName || 'secretbox-export.xls',
        fail: () => {
          wx.showToast({
            title: '当前环境不支持直接分享文件',
            icon: 'none'
          });
        }
      });
      return;
    }

    wx.showToast({
      title: '当前环境不支持直接分享文件，请先预览后转发',
      icon: 'none'
    });
  },

  closeExportActions() {
    this.setData({ showExportActions: false });
  }
})