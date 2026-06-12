const app = getApp();

function normalizeUserInfo(userInfo) {
  const normalized = typeof app.normalizeUserInfo === 'function' ? app.normalizeUserInfo(userInfo) : (userInfo || {});
  const adminLevel = normalized.adminLevel || 'none';
  return {
    ...normalized,
    role: normalized.role || 'student',
    adminLevel,
    hasAdminAccess: typeof app.hasAdminAccess === 'function'
      ? app.hasAdminAccess(normalized)
      : ['admin', 'super_admin'].includes(adminLevel)
  };
}

Page({
  data: {
    loading: true,
    creatingInvitation: false,
    reviewingId: null,
    currentTab: 'applications',
    userInfo: {},
    applications: [],
    invitations: [],
    inviteForm: {
      targetWechatId: '',
      note: ''
    }
  },

  onLoad() {
    this.refreshUserInfo();
    this.loadData();
  },

  onShow() {
    this.refreshUserInfo();
    this.loadData();
  },

  refreshUserInfo() {
    const userInfo = normalizeUserInfo(app.globalData.userInfo);
    this.setData({ userInfo });
    return userInfo;
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

  loadData() {
    this.refreshUserInfo();
    this.setData({ loading: true });

    Promise.all([
      this.request({ url: `${app.globalData.baseUrl}/admin/applications`, method: 'GET' }),
      this.request({ url: `${app.globalData.baseUrl}/admin/invitations`, method: 'GET' })
    ]).then(([applicationsRes, invitationsRes]) => {
      this.setData({ loading: false });
      if (applicationsRes.statusCode !== 200) {
        wx.showToast({ title: applicationsRes.data?.error || '申请列表加载失败', icon: 'none' });
        return;
      }
      if (invitationsRes.statusCode !== 200) {
        wx.showToast({ title: invitationsRes.data?.error || '邀请列表加载失败', icon: 'none' });
        return;
      }

      this.setData({
        applications: Array.isArray(applicationsRes.data?.items) ? applicationsRes.data.items : [],
        invitations: Array.isArray(invitationsRes.data?.items) ? invitationsRes.data.items : []
      });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '管理数据加载失败', icon: 'none' });
    });
  },

  switchTab(e) {
    const currentTab = e.currentTarget.dataset.tab;
    if (!currentTab || currentTab === this.data.currentTab) {
      return;
    }
    this.setData({ currentTab });
  },

  onInviteWechatIdInput(e) {
    this.setData({ 'inviteForm.targetWechatId': e.detail.value });
  },

  onInviteNoteInput(e) {
    this.setData({ 'inviteForm.note': e.detail.value });
  },

  createInvitation() {
    const targetWechatId = (this.data.inviteForm.targetWechatId || '').trim();
    const note = (this.data.inviteForm.note || '').trim();
    if (!targetWechatId || this.data.creatingInvitation) {
      wx.showToast({ title: '请填写目标微信号', icon: 'none' });
      return;
    }

    this.setData({ creatingInvitation: true });
    this.request({
      url: `${app.globalData.baseUrl}/admin/invitations`,
      method: 'POST',
      data: {
        targetWechatId,
        note
      }
    }).then((res) => {
      this.setData({ creatingInvitation: false });
      if (res.statusCode !== 200 || !res.data?.success) {
        wx.showToast({ title: res.data?.error || '邀请失败', icon: 'none' });
        return;
      }

      wx.showToast({ title: '邀请已创建', icon: 'success' });
      this.setData({
        inviteForm: {
          targetWechatId: '',
          note: ''
        },
        currentTab: 'invitations'
      });
      this.loadData();
    }).catch(() => {
      this.setData({ creatingInvitation: false });
      wx.showToast({ title: '邀请失败', icon: 'none' });
    });
  },

  reviewApplication(e) {
    const applicationId = Number(e.currentTarget.dataset.id || 0);
    const action = e.currentTarget.dataset.action;
    if (!applicationId || !action || this.data.reviewingId) {
      return;
    }

    const actionText = action === 'approve' ? '通过' : '拒绝';
    wx.showModal({
      title: '审核管理员申请',
      content: `确认${actionText}这条管理员申请吗？`,
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.setData({ reviewingId: applicationId });
        this.request({
          url: `${app.globalData.baseUrl}/admin/applications/${applicationId}/review`,
          method: 'POST',
          data: {
            action
          }
        }).then((res) => {
          this.setData({ reviewingId: null });
          if (res.statusCode !== 200 || !res.data?.success) {
            wx.showToast({ title: res.data?.error || '审核失败', icon: 'none' });
            return;
          }

          wx.showToast({ title: `已${actionText}`, icon: 'success' });
          this.loadData();
        }).catch(() => {
          this.setData({ reviewingId: null });
          wx.showToast({ title: '审核失败', icon: 'none' });
        });
      }
    });
  }
});