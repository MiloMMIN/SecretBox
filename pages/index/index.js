const app = getApp();

function isVisibleInSquare(question) {
  return !!question?.isPublic && question.auditStatus === 'passed' && question.reviewStatus === 'approved';
}

function buildSubmissionStatus(question) {
  if (!question?.isPublic) {
    return {
      submissionStatusText: '',
      submissionStatusClass: '',
      submissionDetailText: ''
    };
  }

  if (question.auditStatus === 'pending') {
    return {
      submissionStatusText: '系统审核中',
      submissionStatusClass: 'pending',
      submissionDetailText: '提交成功，暂未公开展示'
    };
  }

  if (question.auditStatus === 'failed') {
    return {
      submissionStatusText: '待复核',
      submissionStatusClass: 'pending',
      submissionDetailText: question.reviewReason || '系统审核暂时异常，请稍后查看结果'
    };
  }

  if (question.auditStatus === 'rejected') {
    return {
      submissionStatusText: '未通过',
      submissionStatusClass: 'rejected',
      submissionDetailText: question.reviewReason || '内容未通过平台审核'
    };
  }

  if (question.reviewStatus === 'pending') {
    return {
      submissionStatusText: '待审核',
      submissionStatusClass: 'pending',
      submissionDetailText: '系统审核已通过，等待教师审核'
    };
  }

  if (question.reviewStatus === 'rejected') {
    return {
      submissionStatusText: '已驳回',
      submissionStatusClass: 'rejected',
      submissionDetailText: question.reviewReason ? `驳回理由：${question.reviewReason}` : '未在广场展示'
    };
  }

  return {
    submissionStatusText: '已通过',
    submissionStatusClass: 'approved',
    submissionDetailText: '已在广场展示'
  };
}

function decorateSubmission(question) {
  return {
    ...question,
    ...buildSubmissionStatus(question),
    showSquareSubmissionStatus: !!question?.isPublic && !isVisibleInSquare(question)
  };
}

Page({
  data: {
    questions: [],
    allQuestions: [],
    mySquareSubmissions: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    loadingQuestions: false,
    loadingMySquareSubmissions: false,
    currentSort: 'time',
    searchKeyword: '',
    showLoginModal: false,
    loginSubmitting: false,
    userInfo: {
      avatarUrl: '',
      nickName: ''
    },
    // 详情页相关
    showDetail: false,
    currentQuestion: null,
    replyContent: '',
    replyImages: [],
    uploadingReplyImage: false
  },

  onLoad: function (options) {
    // 检查登录状态
    if (!app.globalData.isLoggedIn) {
      this.setData({ showLoginModal: true });
    } else {
      this.loadQuestions();
      this.loadMySquareSubmissions();
    }
  },

  onShow: function() {
    if (app.globalData.isLoggedIn) {
      this.loadQuestions();
      this.loadMySquareSubmissions();
    }
  },

  // --- 登录逻辑 ---
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({
      'userInfo.avatarUrl': avatarUrl
    });
  },

  onNicknameChange(e) {
    this.setData({
      'userInfo.nickName': e.detail.value
    });
  },

  confirmLogin() {
    const { avatarUrl, nickName } = this.data.userInfo;
    if (!avatarUrl || !nickName) {
      wx.showToast({ title: '请完善信息', icon: 'none' });
      return;
    }

    if (this.data.loginSubmitting) {
      return;
    }
    
    this.setData({ loginSubmitting: true });
    wx.showLoading({ title: '登录中...' });
    app.login(this.data.userInfo).then(user => {
      wx.hideLoading();
      this.setData({ showLoginModal: false, loginSubmitting: false });
      wx.showToast({ title: '欢迎回来', icon: 'success' });
      this.loadQuestions();
      this.loadMySquareSubmissions();
    }).catch(err => {
      wx.hideLoading();
      this.setData({ loginSubmitting: false });
      console.error(err);
      wx.showToast({
        title: typeof err === 'string' ? err : '登录失败',
        icon: 'none'
      });
    });
  },

  loadQuestions(options = {}) {
    const { append = false } = options;
    if (this.data.loadingQuestions) {
      return;
    }

    if (append && !this.data.hasMore) {
      return;
    }

    const targetPage = append ? (this.data.page + 1) : 1;
    const token = wx.getStorageSync('token');
    this.setData({ loadingQuestions: true });
    wx.request({
      url: `${app.globalData.baseUrl}/questions`,
      method: 'GET',
      header: token ? { 'Authorization': token } : {},
      data: {
        search: this.data.searchKeyword,
        sort: this.data.currentSort,
        page: targetPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        if (res.statusCode === 200) {
          const payload = res.data || {};
          const items = Array.isArray(payload) ? payload : (payload.items || []);
          const pagination = Array.isArray(payload) ? null : (payload.pagination || {});
          this.setData({
            questions: append ? [...this.data.questions, ...items] : items,
            page: targetPage,
            hasMore: pagination ? !!pagination.hasMore : (items.length >= this.data.pageSize)
          });
          return;
        }
        wx.showToast({ title: res.data?.error || '列表加载失败', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '列表加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loadingQuestions: false });
      }
    });
  },

  loadMySquareSubmissions() {
    const token = wx.getStorageSync('token');
    if (!token) {
      this.setData({ mySquareSubmissions: [] });
      return;
    }

    this.setData({ loadingMySquareSubmissions: true });
    wx.request({
      url: `${app.globalData.baseUrl}/my/questions`,
      method: 'GET',
      header: {
        Authorization: token
      },
      success: (res) => {
        if (res.statusCode === 200) {
          const submissions = (res.data || []).filter((item) => (
            item.isPublic && !isVisibleInSquare(item)
          )).map(decorateSubmission);
          this.setData({ mySquareSubmissions: submissions });
          return;
        }

        wx.showToast({ title: res.data?.error || '投稿进度加载失败', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '投稿进度加载失败', icon: 'none' });
      },
      complete: () => {
        this.setData({ loadingMySquareSubmissions: false });
      }
    });
  },

  // ... 之前的排序和搜索逻辑 ...
  changeSort: function(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ currentSort: type }, () => {
        this.loadQuestions();
    });
  },

  onSearchInput: function(e) {
    this.setData({ searchKeyword: e.detail.value });
  },

  onSearch: function() {
    this.loadQuestions();
  },

  onReachBottom() {
    if (!app.globalData.isLoggedIn) {
      return;
    }
    this.loadQuestions({ append: true });
  },

  // --- 详情页逻辑 ---
  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    console.log('点击查看详情，ID:', id); // 调试日志
    this.fetchQuestionDetail(id);
  },

  fetchQuestionDetail(id) {
    wx.showLoading({ title: '加载中' });
    const token = wx.getStorageSync('token');
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${id}`,
      method: 'GET',
      header: token ? { 'Authorization': token } : {},
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          const question = decorateSubmission(res.data || {});
          this.setData({
            currentQuestion: question,
            showDetail: true
          });
        }
      }
    });
  },

  onDetailClose() {
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
        if (!files.length) {
          return;
        }
        this.uploadReplyImages(files);
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
          'Authorization': token
        },
        success: (res) => {
          const data = JSON.parse(res.data || '{}');
          if (res.statusCode === 200 && data.success) {
            uploaded.push(data.url);
            uploadNext(index + 1);
            return;
          }

          this.setData({ uploadingReplyImage: false });
          wx.showToast({
            title: data.error || '图片上传失败',
            icon: 'none'
          });
        },
        fail: () => {
          this.setData({ uploadingReplyImage: false });
          wx.showToast({
            title: '图片上传失败',
            icon: 'none'
          });
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

  toggleStar(e) {
    const qid = e.currentTarget.dataset.id;
    this.requestToggleStar(qid);
  },

  toggleCurrentQuestionStar() {
    if (!this.data.currentQuestion.id) {
      return;
    }
    this.requestToggleStar(this.data.currentQuestion.id, true);
  },

  requestToggleStar(qid, fromDetail = false) {
    const token = wx.getStorageSync('token');
    if (!token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.request({
      url: `${app.globalData.baseUrl}/questions/${qid}/star`,
      method: 'POST',
      header: {
        'Authorization': token
      },
      success: (res) => {
        if (res.statusCode !== 200 || !res.data.success) {
          wx.showToast({ title: res.data?.error || '收藏失败', icon: 'none' });
          return;
        }

        const questions = this.data.questions.map((item) => item.id === qid ? {
          ...item,
          stars: res.data.stars,
          starred: res.data.starred
        } : item);
        this.setData({ questions });

        if (fromDetail || (this.data.currentQuestion && this.data.currentQuestion.id === qid)) {
          this.setData({
            currentQuestion: {
              ...this.data.currentQuestion,
              stars: res.data.stars,
              starred: res.data.starred
            }
          });
        }
      },
      fail: () => {
        wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' });
      }
    });
  },

  submitReply() {
    if (!this.data.replyContent.trim() && this.data.replyImages.length === 0) {
      wx.showToast({ title: '请输入内容或上传图片', icon: 'none' });
      return;
    }
    
    const qid = this.data.currentQuestion.id;
    wx.showLoading({ title: '发送中' });
    
    wx.request({
      url: `${app.globalData.baseUrl}/questions/${qid}/replies`,
      method: 'POST',
      header: {
        'Authorization': wx.getStorageSync('token')
      },
      data: {
        content: this.data.replyContent.trim(),
        images: this.data.replyImages
      },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200) {
          wx.showToast({ title: '回复成功', icon: 'success' });
          this.setData({ replyContent: '', replyImages: [] });
          // 刷新详情
          this.fetchQuestionDetail(qid);
          this.loadQuestions();
          this.loadMySquareSubmissions();
        } else {
            wx.showToast({ title: '回复失败', icon: 'none' });
        }
      }
    });
  },

  onTapPost: function() {
    console.log('onTapPost triggered');
    if (!app.globalData.isLoggedIn) {
      console.log('User not logged in, showing modal');
      this.setData({ showLoginModal: true });
      return;
    }
    console.log('Navigating to square post page');
    wx.navigateTo({
      url: '/pages/square_post/index',
      success: () => {
        console.log('Navigate success');
      },
      fail: (err) => {
        console.error('Navigate failed:', err);
        wx.showToast({
          title: '无法跳转',
          icon: 'none'
        });
      }
    });
  }
})
