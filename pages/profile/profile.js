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

function buildQuestionStatus(question) {
  if (question?.isPublic) {
    const reviewStatus = question.reviewStatus || 'pending';
    const auditStatus = question.auditStatus || 'passed';
    const reviewStatusTextMap = {
      pending: '审核中',
      approved: '已通过',
      rejected: '未通过'
    };

    if (auditStatus === 'pending') {
      return {
        statusText: '审核中',
        statusClass: 'pending',
        detailText: '系统审核中，暂未公开展示'
      };
    }

    if (auditStatus === 'failed') {
      return {
        statusText: '待复核',
        statusClass: 'pending',
        detailText: question.reviewReason || '系统审核暂时异常，请稍后查看结果'
      };
    }

    if (auditStatus === 'rejected') {
      return {
        statusText: '未通过',
        statusClass: 'rejected',
        detailText: question.reviewReason || '内容未通过平台审核，未在广场展示'
      };
    }

    if (reviewStatus === 'pending') {
      return {
        statusText: '待审核',
        statusClass: 'pending',
        detailText: '系统审核已通过，等待教师审核'
      };
    }

    if (reviewStatus === 'rejected') {
      return {
        statusText: '已驳回',
        statusClass: 'rejected',
        detailText: question.reviewReason ? `驳回理由：${question.reviewReason}` : '未在广场展示'
      };
    }

    return {
      statusText: reviewStatusTextMap[reviewStatus] || '审核中',
      statusClass: reviewStatus,
      detailText: reviewStatus === 'approved' ? '已在广场展示' : '审核中，暂未公开展示'
    };
  }

  return {
    statusText: question?.hasTeacherReply ? '教师已回复' : '待解决',
    statusClass: question?.hasTeacherReply ? 'replied' : 'pending',
    detailText: question?.hasTeacherReply ? '可进入查看回复' : '已投递给老师'
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
      reviewPendingCount: 0,
      todayCount: 0,
      inboxCount: 0,
      squareCount: 0
    },
    teacherQuestions: [],
    teacherViewScope: 'pending',
    teacherViewTitle: '待回复',
    teacherPage: 1,
    teacherPageSize: 10,
    teacherHasMore: true,
    showTeacherQuestions: false,
    teacherLoading: false,
    teacherLoadingMore: false,
    teacherInviteCode: '',
    showTeacherUpgrade: false,
    exportFilePath: '',
    exportFileName: '',
    showExportActions: false,
    showMyQuestions: false,
    showMyReplies: false,
    showDetail: false,
    currentQuestion: null,
    replyContent: '',
    replyImages: [],
    uploadingReplyImage: false,
    avatarUploading: false
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

    if (this.data.avatarUploading) {
      return;
    }

    this.setData({ avatarUploading: true });
    wx.showLoading({ title: '上传头像中...' });
    app.uploadAvatar(avatarUrl).then((remoteAvatarUrl) => {
      this.setData({
        'userInfo.avatarUrl': remoteAvatarUrl
      });
      return this.updateUserProfile({ avatarUrl: remoteAvatarUrl }, false);
    }).then(() => {
      this.setData({ avatarUploading: false });
      wx.hideLoading();
      wx.showToast({
        title: '头像已更新',
        icon: 'success'
      });
    }).catch((error) => {
      this.setData({ avatarUploading: false });
      wx.hideLoading();
      wx.showToast({
        title: error?.message || '头像上传失败',
        icon: 'none'
      });
    });
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

  updateUserProfile(overrides = {}, showSuccess = true) {
      const token = wx.getStorageSync('token');
      if (!token) {
        wx.showToast({
          title: '请先登录',
          icon: 'none'
        });
        return;
      }

      const payload = {
        nickName: (overrides.nickName !== undefined ? overrides.nickName : this.data.userInfo.nickName || '').trim(),
        avatarUrl: overrides.avatarUrl !== undefined ? overrides.avatarUrl : (this.data.userInfo.avatarUrl || '')
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
        wx.showToast({
          title: error?.message || '更新失败',
          icon: 'none'
        });
        throw error;
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
          const myQuestions = (res.data || []).map((item) => ({
            ...item,
            ...buildQuestionStatus(item)
          }));
          this.setData({ myQuestions });
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

  loadTeacherQuestions(scope, title, options = {}) {
    const { append = false } = options;
    if (append && (this.data.teacherLoadingMore || !this.data.teacherHasMore)) {
      return;
    }

    const targetPage = append ? (this.data.teacherPage + 1) : 1;
    this.setData({
      teacherViewScope: scope,
      teacherViewTitle: title,
      showTeacherQuestions: true,
      teacherLoading: append ? this.data.teacherLoading : true,
      teacherLoadingMore: append
    });

    wx.request({
      url: `${app.globalData.baseUrl}/teacher/questions`,
      method: 'GET',
      header: { 'Authorization': wx.getStorageSync('token') },
      data: {
        scope,
        page: targetPage,
        pageSize: this.data.teacherPageSize
      },
      success: (res) => {
        this.setData({ teacherLoading: false, teacherLoadingMore: false });
        if (res.statusCode === 200) {
          const payload = res.data || {};
          const items = Array.isArray(payload) ? payload : (payload.items || []);
          const pagination = Array.isArray(payload) ? null : (payload.pagination || {});
          this.setData({
            teacherQuestions: append ? [...this.data.teacherQuestions, ...items] : items,
            teacherPage: targetPage,
            teacherHasMore: pagination ? !!pagination.hasMore : (items.length >= this.data.teacherPageSize)
          });
          this.markTeacherNotificationsRead();
          return;
        }

        wx.showToast({
          title: res.data?.error || '教师列表加载失败',
          icon: 'none'
        });
      },
      fail: () => {
        this.setData({ teacherLoading: false, teacherLoadingMore: false });
        wx.showToast({
          title: '教师列表加载失败',
          icon: 'none'
        });
      }
    });
  },

  loadMoreTeacherQuestions() {
    if (!this.data.showTeacherQuestions) {
      return;
    }
    this.loadTeacherQuestions(this.data.teacherViewScope, this.data.teacherViewTitle, { append: true });
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
            currentQuestion: res.data,
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
          const data = JSON.parse(res.data || '{}');
          if (res.statusCode === 200 && data.success) {
            uploaded.push(data.url);
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
    const urls = e.currentTarget.dataset.urls || this.data.replyImages;
    wx.previewImage({
      current: url,
      urls
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
          this.getMyQuestions();
          if (this.data.userInfo.role === 'teacher') {
            this.loadTeacherDashboard();
            if (this.data.showTeacherQuestions) {
              this.loadTeacherQuestions(this.data.teacherViewScope, this.data.teacherViewTitle);
            }
          }
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
