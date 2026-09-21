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
    granting: false,
    removingId: null,
    currentTab: 'applications',
    userInfo: {},
    isSuperAdmin: false,
    applications: [],
    invitations: [],
    admins: [],
    inviteForm: {
      targetWechatId: '',
      note: ''
    },
    adminForm: {
      wechatId: '',
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
    this.setData({
      userInfo,
      isSuperAdmin: userInfo.adminLevel === 'super_admin'
    });
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
      this.request({ url: `${app.globalData.baseUrl}/admin/invitations`, method: 'GET' }),
      this.request({ url: `${app.globalData.baseUrl}/admin/admins`, method: 'GET' })
    ]).then(([applicationsRes, invitationsRes, adminsRes]) => {
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
        invitations: Array.isArray(invitationsRes.data?.items) ? invitationsRes.data.items : [],
        admins: adminsRes.statusCode === 200 && Array.isArray(adminsRes.data?.items) ? adminsRes.data.items : []
      });
      if (adminsRes.statusCode !== 200) {
        wx.showToast({ title: adminsRes.data?.error || '管理员名单加载失败', icon: 'none' });
      }
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
  },

  onAdminWechatIdInput(e) {
    this.setData({ 'adminForm.wechatId': e.detail.value });
  },

  onAdminNoteInput(e) {
    this.setData({ 'adminForm.note': e.detail.value });
  },

  grantAdmin() {
    const wechatId = (this.data.adminForm.wechatId || '').trim();
    if (!wechatId || this.data.granting) {
      wx.showToast({ title: '请填写目标微信号', icon: 'none' });
      return;
    }

    this.setData({ granting: true });
    this.request({
      url: `${app.globalData.baseUrl}/admin/admins`,
      method: 'POST',
      data: {
        wechatId,
        note: (this.data.adminForm.note || '').trim()
      }
    }).then((res) => {
      this.setData({ granting: false });
      if (res.statusCode === 200 && res.data?.success) {
        wx.showToast({ title: '已授权为管理员', icon: 'success' });
        this.setData({ 'adminForm.wechatId': '', 'adminForm.note': '' });
        this.loadData();
        return;
      }
      wx.showToast({ title: res.data?.error || '授权失败', icon: 'none' });
    }).catch(() => {
      this.setData({ granting: false });
      wx.showToast({ title: '授权失败', icon: 'none' });
    });
  },

  removeAdmin(e) {
    const userId = e.currentTarget.dataset.id;
    wx.showModal({
      title: '移除管理员',
      content: '移除后该账号将失去全部管理权限，确定继续？',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }
        this.setData({ removingId: userId });
        this.request({
          url: `${app.globalData.baseUrl}/admin/admins/${userId}`,
          method: 'DELETE'
        }).then((res) => {
          this.setData({ removingId: null });
          if (res.statusCode === 200 && res.data?.success) {
            wx.showToast({ title: '已移除', icon: 'success' });
            this.loadData();
            return;
          }
          wx.showToast({ title: res.data?.error || '移除失败', icon: 'none' });
        }).catch(() => {
          this.setData({ removingId: null });
          wx.showToast({ title: '移除失败', icon: 'none' });
        });
      }
    });
  }
});