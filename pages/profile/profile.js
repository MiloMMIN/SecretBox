// pages/profile/profile.js
const app = getApp()

function canUseTeacherFeatures(userInfo) {
  if (typeof app.canUseTeacherFeatures === 'function') {
    return app.canUseTeacherFeatures(userInfo || {});
  }

  const role = userInfo?.role || 'student';
  const adminLevel = userInfo?.adminLevel || userInfo?.admin_level || 'none';
  return role === 'teacher' || adminLevel === 'admin' || adminLevel === 'super_admin';
}

function normalizeUserInfo(userInfo) {
  const normalized = typeof app.normalizeUserInfo === 'function' ? app.normalizeUserInfo(userInfo) : userInfo;
  if (!normalized) {
    return {
      nickName: '',
      avatarUrl: '',
      role: 'guest',
      adminLevel: 'none',
      wechatId: '',
      hasAdminAccess: false,
      canUseTeacherFeatures: false,
      canManageAdmins: false,
      roleLabel: '未登录',
      roleBadges: [
        {
          text: '未登录',
          kind: 'guest'
        }
      ]
    };
  }

  const role = normalized.role || 'student';
  const adminLevel = normalized.adminLevel || normalized.admin_level || 'none';
  const hasAdminAccess = typeof app.hasAdminAccess === 'function'
    ? app.hasAdminAccess({ adminLevel })
    : ['admin', 'super_admin'].includes(adminLevel);
  const teacherCapable = canUseTeacherFeatures({
    role,
    adminLevel
  });
  const canManageAdmins = hasAdminAccess;
  let roleLabel = role === 'teacher' ? '教师' : '学生';
  if (adminLevel === 'super_admin') {
    roleLabel = role === 'teacher' ? '最高管理员 / 教师' : '最高管理员';
  } else if (adminLevel === 'admin') {
    roleLabel = role === 'teacher' ? '管理员 / 教师' : '管理员';
  }

  const roleBadges = [
    {
      text: role === 'teacher' ? '教师' : '学生',
      kind: role === 'teacher' ? 'teacher' : 'student'
    }
  ];

  if (adminLevel === 'super_admin') {
    roleBadges.push({
      text: '最高管理员',
      kind: 'super-admin'
    });
  } else if (adminLevel === 'admin') {
    roleBadges.push({
      text: '管理员',
      kind: 'admin'
    });
  }

  return {
    ...normalized,
    nickName: normalized.nickName || normalized.nickname || '微信用户',
    avatarUrl: '',
    role,
    adminLevel,
    wechatId: normalized.wechatId || normalized.wechat_id || '',
    hasAdminAccess,
    canUseTeacherFeatures: teacherCapable,
    canManageAdmins,
    roleLabel,
    roleBadges
  };
}

function buildQuestionStatus(question) {
  return {
    statusText: question?.hasTeacherReply ? '教师已回复' : '待解决',
    statusClass: question?.hasTeacherReply ? 'replied' : 'pending',
    detailText: question?.hasTeacherReply ? '可进入查看回复' : '已投递给老师'
  };
}

Page({
  data: {
    userInfo: {},
    isLoggedIn: false,
    loggingIn: false,
    showTeacherUpgrade: false,
    myQuestions: [],
    teacherStats: {
      inboxCount: 0,
      appointmentCreatedCount: 0,
      appointmentAssignedCount: 0,
      pendingAdminApplicationCount: 0,
      pendingAdminInvitationCount: 0
    },
    teacherQuestions: [],
    teacherViewScope: 'inbox',
    teacherViewTitle: '树洞信箱',
    showTeacherQuestions: false,
    teacherLoading: false,
    exportFilePath: '',
    exportFileName: '',
    showExportActions: false,
    showMyQuestions: false,
    showDetail: false,
    currentQuestion: null,
    replyContent: '',
    replyImages: [],
    uploadingReplyImage: false
  },

  onLoad() {
    const hasToken = !!wx.getStorageSync('token');
    this.setData({
      userInfo: normalizeUserInfo(app.globalData.userInfo),
      isLoggedIn: hasToken
    });
  },

  resetProfilePanels() {
    this.setData({
      userInfo: normalizeUserInfo(app.globalData.userInfo),
      isLoggedIn: !!app.globalData.isLoggedIn,
      myQuestions: [],
      showMyQuestions: false,
      teacherQuestions: [],
      showTeacherQuestions: false,
      teacherLoading: false
    });
  },

  syncCurrentUser() {
    const token = wx.getStorageSync('token');
    if (!token) {
      if (typeof app.clearLoginState === 'function') {
        app.clearLoginState();
      }
      this.resetProfilePanels();
      return Promise.resolve(null);
    }

    const fetchUserTask = typeof app.fetchCurrentUser === 'function'
      ? app.fetchCurrentUser()
      : Promise.resolve(app.globalData.userInfo);

    return Promise.resolve(fetchUserTask).then((latestUserInfo) => {
      if (!latestUserInfo) {
        this.resetProfilePanels();
        return null;
      }

      const userInfo = normalizeUserInfo(latestUserInfo);
      this.setData({
        userInfo,
        isLoggedIn: true
      });
      return userInfo;
    }).catch(() => {
      if (!app.globalData.userInfo) {
        this.resetProfilePanels();
        return null;
      }

      const userInfo = normalizeUserInfo(app.globalData.userInfo);
      this.setData({
        userInfo,
        isLoggedIn: !!token
      });
      return userInfo;
    });
  },

  onShow() {
    this.syncCurrentUser().then((userInfo) => {
      if (!userInfo) {
        return;
      }

      if (userInfo.canUseTeacherFeatures) {
        this.loadTeacherDashboard(true);
        if (this.data.showTeacherQuestions) {
          this.loadTeacherQuestions('inbox', '树洞信箱');
        }
        return;
      }

      this.getMyQuestions();
    });
  },

  // --- 昵称修改 ---

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

      if (!wx.getStorageSync('token') || !this.data.isLoggedIn) {
        return;
      }

      if (nickName && nickName !== currentNickName) {
        const updateTask = this.updateUserProfile({ nickName });
        if (updateTask && typeof updateTask.catch === 'function') {
          updateTask.catch(() => {});
        }
      }
  },

  updateUserProfile(overrides = {}, showSuccess = true, showError = true) {
      const token = wx.getStorageSync('token');
      if (!token) {
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        });
        return;
      }

      const payload = {
        nickName: (overrides.nickName !== undefined ? overrides.nickName : this.data.userInfo.nickName || '').trim()
      };

      return app.updateCurrentUserProfile(payload).then((userInfo) => {
        this.setData({ userInfo });
        if (showSuccess) {
          wx.showToast({
            title: '更新成功',
            icon: 'success'
          });
        }
        return userInfo;
      }).catch((error) => {
        if (showError) {
          wx.showToast({
            title: error?.message || '更新失败',
            icon: 'none'
          });
        }
        throw error;
      });
  },

  startLogin() {
    const nickName = (this.data.userInfo.nickName || '').trim();
    if (!nickName) {
      wx.showToast({
        title: '请先输入昵称',
        icon: 'none'
      });
      return;
    }

    if (this.data.loggingIn) {
      return;
    }

    this.setData({ loggingIn: true });
    wx.showLoading({ title: '登录中...' });

    app.login({ nickName }).then((latestUserInfo) => {
      wx.hideLoading();
      const userInfo = normalizeUserInfo(latestUserInfo);
      this.setData({
        userInfo,
        isLoggedIn: true,
        loggingIn: false
      });
      wx.showToast({
        title: '登录成功',
        icon: 'success'
      });

      if (userInfo.canUseTeacherFeatures) {
        this.loadTeacherDashboard(true);
        return;
      }

      this.getMyQuestions();
    }).catch((error) => {
      wx.hideLoading();
      this.setData({ loggingIn: false });
      wx.showToast({
        title: error?.message || error || '登录失败',
        icon: 'none'
      });
    });
  },

  // --- 列表展示 ---
  toggleMyQuestions() {
    if (!wx.getStorageSync('token')) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    this.setData({
      showMyQuestions: !this.data.showMyQuestions
    });
    if (this.data.showMyQuestions && this.data.myQuestions.length === 0) {
        this.getMyQuestions();
    }
  },

  toggleTeacherUpgrade() {
    if (!wx.getStorageSync('token')) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      });
      return;
    }

    this.setData({
      showTeacherUpgrade: !this.data.showTeacherUpgrade
    });
  },

  onImageError(e) {
    const { type, index } = e.currentTarget.dataset;
    if (type === 'user') {
      this.setData({ 'userInfo.avatarError': true });
    } else if (type === 'reply') {
      const currentQuestion = this.data.currentQuestion;
      if (currentQuestion && currentQuestion.replies && currentQuestion.replies[index]) {
        currentQuestion.replies[index].user = currentQuestion.replies[index].user || {};
        currentQuestion.replies[index].user.avatarError = true;
        this.setData({ currentQuestion });
      }
    }
  },


  getMyQuestions() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({
        myQuestions: [],
        showMyQuestions: false
      });
      return;
    }

    wx.request({
      url: `${app.globalData.baseUrl}/my/questions`,
      method: 'GET',
      header: { Authorization: token },
      success: (res) => {
        if (res.statusCode === 200) {
          const myQuestions = (res.data || [])
            .map((item) => app.normalizeQuestion(item))
            .filter((item) => item.isPublic !== true)
            .map((item) => ({
              ...item,
              ...buildQuestionStatus(item)
            }));
          this.setData({ myQuestions });
          return;
        }

        if (res.statusCode === 401) {
          if (typeof app.clearLoginState === 'function') {
            app.clearLoginState();
          }
          this.resetProfilePanels();
          wx.showToast({
            title: '登录已失效，请重新进入',
            icon: 'none'
          });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载提问失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.showToast({
          title: '私密投递加载失败',
          icon: 'none'
        });
      }
    });
  },

  loadTeacherDashboard(markSeen = false) {
    wx.request({
      url: `${app.globalData.baseUrl}/teacher/dashboard`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        if (res.statusCode === 200) {
          const teacherStats = {
            ...this.data.teacherStats,
            ...(res.data || {})
          };
          this.setData({
            teacherStats
          });
          if (markSeen) {
            this.markTeacherNotificationsRead(teacherStats.inboxCount);
          }
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
          const data = res.data || {};
          const teacherQuestions = (data.items || [])
            .map((item) => app.normalizeQuestion(item))
            .filter((item) => item.isPublic !== true);
          this.setData({ teacherQuestions });
          if (scope === 'inbox') {
            this.markTeacherNotificationsRead(this.data.teacherStats.inboxCount);
          }
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
      const id = e.currentTarget.dataset.id;
      this.fetchQuestionDetail(id);
  },

  fetchQuestionDetail(id) {
    wx.showLoading({ title: '加载中' });
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${id}`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          this.setData({
            currentQuestion: app.normalizeQuestion(res.data),
            showDetail: true
          });
          return;
        }

        wx.showToast({
          title: res.data?.error || '加载详情失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({
          title: '加载详情失败',
          icon: 'none'
        });
      }
    });
  },

  closeDetail() {
    this.setData({
      showDetail: false,
      currentQuestion: null,
      replyContent: '',
      replyImages: []
    });
  },

  onReplyInput(e) {
    this.setData({ replyContent: e.detail.value });
  },

  chooseReplyImages() {
    if (this.data.uploadingReplyImage) {
      return;
    }

    const remainCount = 3 - this.data.replyImages.length;
    if (remainCount <= 0) {
      wx.showToast({
        title: '最多上传3张图片',
        icon: 'none'
      });
      return;
    }

    wx.chooseMedia({
      count: remainCount,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const files = (res.tempFiles || []).map((item) => item.tempFilePath);
        if (files.length) {
          this.uploadReplyImages(files);
        }
      }
    });
  },

  uploadReplyImages(filePaths) {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    this.setData({ uploadingReplyImage: true });
    const uploaded = [];

    const uploadNext = (index) => {
      if (index >= filePaths.length) {
        this.setData({
          replyImages: [...this.data.replyImages, ...uploaded],
          uploadingReplyImage: false
        });
        return;
      }

      wx.uploadFile({
        url: `${app.globalData.baseUrl}/uploads/image`,
        filePath: filePaths[index],
        name: 'file',
        header: {
          Authorization: token
        },
        success: (res) => {
          let data = {};
          try {
            data = JSON.parse(res.data || '{}');
          } catch (error) {
            this.setData({ uploadingReplyImage: false });
            wx.showToast({ title: '图片上传失败', icon: 'none' });
            return;
          }

          if (res.statusCode === 200 && data.success) {
            uploaded.push(app.normalizeFileUrl(data.url));
            uploadNext(index + 1);
            return;
          }

          this.setData({ uploadingReplyImage: false });
          wx.showToast({ title: data.error || '图片上传失败', icon: 'none' });
        },
        fail: () => {
          this.setData({ uploadingReplyImage: false });
          wx.showToast({ title: '图片上传失败', icon: 'none' });
        }
      });
    };

    uploadNext(0);
  },

  removeReplyImage(e) {
    const index = e.currentTarget.dataset.index;
    const nextImages = [...this.data.replyImages];
    nextImages.splice(index, 1);
    this.setData({ replyImages: nextImages });
  },

  previewReplyImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = e.currentTarget.dataset.urls;
    wx.previewImage({
      current: url,
      urls: urls && urls.length ? urls : [url]
    });
  },

  submitReply() {
    if (!this.data.replyContent.trim() && this.data.replyImages.length === 0) {
      wx.showToast({ title: '请输入内容或上传图片', icon: 'none' });
      return;
    }

    const qid = this.data.currentQuestion?.id;
    if (!qid) {
      return;
    }

    wx.showLoading({ title: '发送中' });
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${qid}/replies`,
      method: 'POST',
      header: { 'Authorization': wx.getStorageSync('token') },
      data: {
        content: this.data.replyContent.trim(),
        images: this.data.replyImages
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.showToast({ title: '回复成功', icon: 'success' });
          this.setData({ replyContent: '', replyImages: [] });
          this.fetchQuestionDetail(qid);
          if (this.data.userInfo.canUseTeacherFeatures) {
            this.loadTeacherDashboard();
            if (this.data.showTeacherQuestions) {
              this.loadTeacherQuestions('inbox', '树洞信箱');
            }
            return;
          }

          this.getMyQuestions();
          return;
        }

        wx.showToast({
          title: res.data?.error || '回复失败',
          icon: 'none'
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({
          title: '回复失败',
          icon: 'none'
        });
      }
    });
  },

  showInbox() {
    if (!this.data.userInfo.canUseTeacherFeatures) {
      wx.showToast({
        title: '当前账号无教师权限',
        icon: 'none'
      });
      return;
    }

    this.loadTeacherQuestions('inbox', '树洞信箱');
  },

  markTeacherNotificationsRead(inboxCount) {
    if (typeof inboxCount === 'number' && !Number.isNaN(inboxCount)) {
      wx.setStorageSync('teacherInboxSeenCount', inboxCount);
    }

    wx.request({
      url: `${app.globalData.baseUrl}/teacher/notifications/read`,
      method: 'POST',
      header: { 'Authorization': wx.getStorageSync('token') },
      complete: () => {
        app.refreshTeacherNotificationBadge();
      }
    });
  },

  showCounselorManager() {
    if (!this.data.userInfo.canManageAdmins) {
      wx.showToast({
        title: '当前账号无教师管理权限',
        icon: 'none'
      });
      return;
    }

    wx.navigateTo({
      url: '/pages/teacher/counselor_manage/index'
    });
  },

  showAdminManager() {
    if (!this.data.userInfo.canManageAdmins) {
      wx.showToast({
        title: '当前账号无管理员权限',
        icon: 'none'
      });
      return;
    }

    wx.navigateTo({
      url: '/pages/teacher/admin_manage/index'
    });
  },

  exportData() {
    if (!this.data.userInfo.canUseTeacherFeatures) {
      wx.showToast({
        title: '当前账号无教师权限',
        icon: 'none'
      });
      return;
    }

    const scope = this.data.teacherViewScope || 'inbox';
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
