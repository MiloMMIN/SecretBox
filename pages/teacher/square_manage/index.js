const app = getApp();

Page({
  data: {
    loading: false,
    loadingMore: false,
    questions: [],
    page: 1,
    pageSize: 20,
    hasMore: true,
    reviewFilter: 'pending',
    reviewFilterLabel: '待审核',
    showDetail: false,
    currentQuestion: null,
    showRejectDialog: false,
    rejectReason: '',
    rejectQuestionId: null
  },

  onLoad() {
    this.loadQuestions();
  },

  onShow() {
    this.loadQuestions();
  },

  request(options) {
    const token = wx.getStorageSync('token');
    return new Promise((resolve, reject) => {
      wx.request({
        ...options,
        header: {
          ...(options.header || {}),
          Authorization: token
        },
        success: resolve,
        fail: reject
      });
    });
  },

  loadQuestions(options = {}) {
    const { append = false } = options;
    if (append && (this.data.loadingMore || !this.data.hasMore)) {
      return;
    }

    const targetPage = append ? (this.data.page + 1) : 1;
    this.setData({
      loading: append ? this.data.loading : true,
      loadingMore: append
    });
    this.request({
      url: `${app.globalData.baseUrl}/teacher/questions`,
      method: 'GET',
      data: {
        scope: 'square',
        reviewStatus: this.data.reviewFilter,
        page: targetPage,
        pageSize: this.data.pageSize
      }
    }).then((res) => {
      this.setData({ loading: false, loadingMore: false });
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
      wx.showToast({ title: res.data?.error || '加载失败', icon: 'none' });
    }).catch(() => {
      this.setData({ loading: false, loadingMore: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  changeReviewFilter(e) {
    const filter = e.currentTarget.dataset.filter;
    const label = e.currentTarget.dataset.label;
    if (filter === this.data.reviewFilter) {
      return;
    }

    this.setData({
      reviewFilter: filter,
      reviewFilterLabel: label,
      page: 1,
      hasMore: true,
      showDetail: false,
      currentQuestion: null
    });
    this.loadQuestions();
  },

  onReachBottom() {
    this.loadQuestions({ append: true });
  },

  openQuestion(e) {
    const id = e.currentTarget.dataset.id;
    wx.showLoading({ title: '加载中' });
    this.request({
      url: `${app.globalData.baseUrl}/questions/${id}`,
      method: 'GET'
    }).then((res) => {
      wx.hideLoading();
      if (res.statusCode === 200) {
        this.setData({
          currentQuestion: res.data,
          showDetail: true
        });
        return;
      }
      wx.showToast({ title: res.data?.error || '加载详情失败', icon: 'none' });
    }).catch(() => {
      wx.hideLoading();
      wx.showToast({ title: '加载详情失败', icon: 'none' });
    });
  },

  closeDetail() {
    this.setData({ showDetail: false, currentQuestion: null });
  },

  deleteQuestion(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除留言',
      content: '删除后问题与其所有回复都会被移除，是否继续？',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.request({
          url: `${app.globalData.baseUrl}/teacher/questions/${id}`,
          method: 'DELETE'
        }).then((res) => {
          if (res.statusCode === 200 && res.data.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            this.closeDetail();
            this.loadQuestions();
            return;
          }
          wx.showToast({ title: res.data?.error || '删除失败', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  reviewQuestion(e) {
    const id = e.currentTarget.dataset.id;
    const action = e.currentTarget.dataset.action;
    const actionText = action === 'approve' ? '通过' : '驳回';

    if (action === 'reject') {
      this.setData({
        showRejectDialog: true,
        rejectReason: '',
        rejectQuestionId: id
      });
      return;
    }

    wx.showModal({
      title: '审核确认',
      content: `确认${actionText}这条广场提问吗？`,
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.submitReview(id, action);
      }
    });
  },

  submitReview(id, action, reason = '') {
    const actionText = action === 'approve' ? '通过' : '驳回';
    this.request({
      url: `${app.globalData.baseUrl}/teacher/questions/${id}/review`,
      method: 'POST',
      data: { action, reason }
    }).then((res) => {
      if (res.statusCode === 200 && res.data.success) {
        wx.showToast({ title: `已${actionText}`, icon: 'success' });
        const shouldKeepDetailOpen = this.data.currentQuestion?.id === id && (
          this.data.reviewFilter === 'all' || this.data.reviewFilter === res.data.reviewStatus
        );

        if (shouldKeepDetailOpen) {
          this.openQuestion({ currentTarget: { dataset: { id } } });
        } else if (this.data.currentQuestion?.id === id) {
          this.closeDetail();
        }

        this.setData({
          showRejectDialog: false,
          rejectReason: '',
          rejectQuestionId: null
        });
        this.loadQuestions();
        return;
      }

      wx.showToast({ title: res.data?.error || '审核失败', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '审核失败', icon: 'none' });
    });
  },

  onRejectReasonInput(e) {
    this.setData({
      rejectReason: e.detail.value
    });
  },

  closeRejectDialog() {
    this.setData({
      showRejectDialog: false,
      rejectReason: '',
      rejectQuestionId: null
    });
  },

  confirmRejectReview() {
    const id = this.data.rejectQuestionId;
    if (!id) {
      return;
    }

    this.submitReview(id, 'reject', (this.data.rejectReason || '').trim());
  },

  deleteReply(e) {
    const id = e.currentTarget.dataset.id;
    const qid = this.data.currentQuestion?.id;
    wx.showModal({
      title: '删除回复',
      content: '确认删除这条回复吗？',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.request({
          url: `${app.globalData.baseUrl}/teacher/replies/${id}`,
          method: 'DELETE'
        }).then((res) => {
          if (res.statusCode === 200 && res.data.success) {
            wx.showToast({ title: '已删除', icon: 'success' });
            if (qid) {
              this.openQuestion({ currentTarget: { dataset: { id: qid } } });
            }
            this.loadQuestions();
            return;
          }
          wx.showToast({ title: res.data?.error || '删除失败', icon: 'none' });
        }).catch(() => {
          wx.showToast({ title: '删除失败', icon: 'none' });
        });
      }
    });
  },

  previewImage(e) {
    const { url, urls } = e.currentTarget.dataset;
    wx.previewImage({
      current: url,
      urls
    });
  }
})
