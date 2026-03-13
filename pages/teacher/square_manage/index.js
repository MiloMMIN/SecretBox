const app = getApp();

Page({
  data: {
    loading: false,
    questions: [],
    showDetail: false,
    currentQuestion: null
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

  loadQuestions() {
    this.setData({ loading: true });
    this.request({
      url: `${app.globalData.baseUrl}/teacher/questions`,
      method: 'GET',
      data: { scope: 'square' }
    }).then((res) => {
      this.setData({ loading: false });
      if (res.statusCode === 200) {
        this.setData({ questions: res.data || [] });
        return;
      }
      wx.showToast({ title: res.data?.error || '加载失败', icon: 'none' });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
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
