const app = getApp();

function normalizeProfile(profile) {
  return app.normalizeTeacherProfile(profile);
}

function buildEditor(profile) {
  if (!profile) {
    return {
      kind: 'invite',
      id: null,
      nickName: '',
      avatarUrl: '',
      desc: '',
      isActive: true,
      shareToken: '',
      claimed: false
    };
  }

  const normalizedProfile = normalizeProfile(profile);
  return {
    kind: normalizedProfile.kind || 'teacher',
    id: normalizedProfile.id,
    nickName: normalizedProfile.nickName || '',
    avatarUrl: normalizedProfile.avatarUrl || '',
    desc: normalizedProfile.desc || '',
    isActive: normalizedProfile.isActive !== false,
    shareToken: '',
    claimed: !!normalizedProfile.claimed
  };
}

Page({
  data: {
    profiles: [],
    currentIndex: 0,
    editor: buildEditor(),
    uploading: false,
    saving: false,
    creating: false,
    shareTokenLoading: false
  },

  onLoad() {
    this.loadProfiles();
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

  loadProfiles() {
    this.request({
      url: `${app.globalData.baseUrl}/teacher/profiles`,
      method: 'GET'
    }).then((res) => {
      if (res.statusCode === 200) {
        const profiles = (res.data || []).map((profile) => normalizeProfile(profile));
        this.setData({
          profiles,
          currentIndex: 0,
          creating: false,
          editor: buildEditor(profiles[0])
        });
        if (profiles[0] && profiles[0].kind === 'invite' && !profiles[0].claimed) {
          this.ensureInviteShareLink(profiles[0].id, false, true);
        }
        return;
      }
      wx.showToast({ title: res.data?.error || '加载失败', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' });
    });
  },

  switchProfile(e) {
    const index = Number(e.currentTarget.dataset.index || 0);
    const profile = this.data.profiles[index];
    this.setData({
      currentIndex: index,
      creating: false,
      editor: buildEditor(profile)
    });

    if (profile && profile.kind === 'invite' && !profile.claimed) {
      this.ensureInviteShareLink(profile.id, false, true);
    }
  },

  createTeacherInvite() {
    this.setData({
      currentIndex: -1,
      creating: true,
      shareTokenLoading: false,
      editor: buildEditor({ kind: 'invite', isActive: true })
    });
  },

  ensureInviteShareLink(inviteId, forceRefresh = false, silent = false) {
    if (!inviteId || this.data.shareTokenLoading) {
      return;
    }

    this.setData({
      shareTokenLoading: true,
      'editor.shareToken': forceRefresh ? '' : (this.data.editor.shareToken || '')
    });

    this.request({
      url: `${app.globalData.baseUrl}/teacher/invites/${inviteId}/share-link`,
      method: 'POST',
      data: {
        forceRefresh
      }
    }).then((res) => {
      this.setData({ shareTokenLoading: false });
      if (res.statusCode === 200 && res.data.success) {
        const shareToken = res.data.shareToken || '';
        if (this.data.editor.id === inviteId && this.data.editor.kind === 'invite') {
          this.setData({
            'editor.shareToken': shareToken
          });
        }
        if (!silent) {
          wx.showToast({ title: '分享链接已准备好', icon: 'success' });
        }
        return;
      }

      if (!silent) {
        wx.showToast({ title: res.data?.error || '分享链接准备失败', icon: 'none' });
      }
    }).catch(() => {
      this.setData({ shareTokenLoading: false });
      if (!silent) {
        wx.showToast({ title: '分享链接准备失败', icon: 'none' });
      }
    });
  },

  refreshInviteShareLink() {
    if (this.data.editor.kind !== 'invite' || !this.data.editor.id) {
      return;
    }

    this.ensureInviteShareLink(this.data.editor.id, true, false);
  },

  onNameInput(e) {
    this.setData({ 'editor.nickName': e.detail.value });
  },

  onDescInput(e) {
    this.setData({ 'editor.desc': e.detail.value });
  },

  onActiveChange(e) {
    this.setData({ 'editor.isActive': e.detail.value });
  },

  chooseAvatar() {
    if (this.data.uploading) {
      return;
    }

    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const filePath = res.tempFiles?.[0]?.tempFilePath;
        if (!filePath) {
          return;
        }
        this.uploadAvatar(filePath);
      }
    });
  },

  uploadAvatar(filePath) {
    const token = wx.getStorageSync('token');
    this.setData({ uploading: true });
    wx.uploadFile({
      url: `${app.globalData.baseUrl}/uploads/image`,
      filePath,
      name: 'file',
      header: { Authorization: token },
      success: (res) => {
        this.setData({ uploading: false });
        let data = {};
        try {
          data = JSON.parse(res.data || '{}');
        } catch (error) {
          wx.showToast({ title: '上传失败', icon: 'none' });
          return;
        }

        if (res.statusCode === 200 && data.success) {
          this.setData({ 'editor.avatarUrl': app.normalizeFileUrl(data.url) });
          return;
        }
        wx.showToast({ title: data.error || '上传失败', icon: 'none' });
      },
      fail: () => {
        this.setData({ uploading: false });
        wx.showToast({ title: '上传失败', icon: 'none' });
      }
    });
  },


  saveProfile() {
    this.setData({ saving: true });
    const isInvite = this.data.editor.kind === 'invite';
    const method = this.data.creating ? 'POST' : 'PUT';
    const url = this.data.creating
      ? `${app.globalData.baseUrl}/teacher/invites`
      : (isInvite
        ? `${app.globalData.baseUrl}/teacher/invites/${this.data.editor.id}`
        : `${app.globalData.baseUrl}/teacher/profiles/${this.data.editor.id}`);

    this.request({
      url,
      method,
      data: {
        nickName: this.data.editor.nickName.trim(),
        avatarUrl: this.data.editor.avatarUrl,
        desc: this.data.editor.desc.trim(),
        isActive: this.data.editor.isActive
      }
    }).then((res) => {
      this.setData({ saving: false });
      if (res.statusCode === 200 && res.data.success) {
        const profile = normalizeProfile(res.data.profile);
        const profiles = [...this.data.profiles];
        if (this.data.creating) {
          profiles.unshift(profile);
        } else {
          profiles[this.data.currentIndex] = profile;
        }

        const nextIndex = this.data.creating ? 0 : this.data.currentIndex;
        const nextEditor = buildEditor(profile);
        if (profile.kind === 'invite' && res.data?.shareToken) {
          nextEditor.shareToken = res.data.shareToken;
        }
        this.setData({
          profiles,
          currentIndex: nextIndex,
          creating: false,
          editor: nextEditor
        });

        if (profile.kind === 'invite' && !profile.claimed && !nextEditor.shareToken) {
          this.ensureInviteShareLink(profile.id, false, true);
        }

        if (profile.kind === 'teacher' && app.globalData.userInfo && app.globalData.userInfo.id === profile.id) {
          const userInfo = {
            ...app.globalData.userInfo,
            nickName: profile.nickName
          };
          app.globalData.userInfo = userInfo;
          wx.setStorageSync('userInfo', userInfo);
        }

        wx.showToast({ title: '保存成功', icon: 'success' });
        return;
      }
      wx.showToast({ title: res.data?.error || '保存失败', icon: 'none' });
    }).catch(() => {
      this.setData({ saving: false });
      wx.showToast({ title: '保存失败', icon: 'none' });
    });
  },

  deleteTeacher() {
    if (this.data.editor.kind !== 'teacher') {
      wx.showToast({ title: '只能删除已激活的教师', icon: 'none' });
      return;
    }

    const teacherId = this.data.editor.id;
    const teacherName = this.data.editor.nickName;

    wx.showModal({
      title: '确认删除',
      content: `确定要删除教师「${teacherName}」吗？删除后该用户将降级为学生身份，其发布的内容不会被删除。`,
      confirmColor: '#FF5252',
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return;
        }

        this.setData({ saving: true });
        this.request({
          url: `${app.globalData.baseUrl}/teacher/profiles/${teacherId}`,
          method: 'DELETE'
        }).then((res) => {
          this.setData({ saving: false });
          console.log('Delete response:', res.statusCode, res.data);
          if (res.statusCode === 200 && res.data.success) {
            wx.showToast({ title: '删除成功', icon: 'success' });
            // Remove from list and reset editor
            const profiles = this.data.profiles.filter(p => p.id !== teacherId);
            this.setData({
              profiles,
              currentIndex: 0,
              editor: buildEditor(profiles[0]),
              creating: false
            });
            return;
          }
          const errorMsg = res.data?.error || `删除失败 (${res.statusCode})`;
          wx.showToast({ title: errorMsg, icon: 'none' });
        }).catch((err) => {
          console.error('Delete error:', err);
          this.setData({ saving: false });
          wx.showToast({ title: '网络错误', icon: 'none' });
        });
      }
    });
  },

  onShareAppMessage() {
    const shareToken = (this.data.editor.shareToken || '').trim();
    let path = '/pages/welcome/index';

    if (shareToken) {
      path += `?teacherInviteToken=${encodeURIComponent(shareToken)}`;
    }

    return {
      title: `邀请你加入智心树洞教师工作台`,
      path
    };
  }
})
