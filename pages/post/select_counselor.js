// pages/post/select_counselor.js
Page({
  data: {
    counselors: []
  },

  onLoad: function (options) {
    // 模拟辅导员数据
    this.setData({
      counselors: [
        {
          id: 0,
          name: "星空树洞",
          avatar: '',
          avatarText: '树',
          desc: "这里没有身份，只有倾听。把秘密告诉星空吧。",
          isTreeHole: true
        },
        {
          id: 1,
          name: "张老师",
          avatar: '',
          avatarText: '张',
          desc: "数智学院辅导员，负责大一学生工作。愿做你的倾听者。"
        },
        {
          id: 2,
          name: "李老师",
          avatar: '',
          avatarText: '李',
          desc: "数智学院辅导员，负责心理健康教育。每一个你都独一无二。"
        },
        {
          id: 3,
          name: "王老师",
          avatar: '',
          avatarText: '王',
          desc: "学工办主任。有困难，找组织。"
        }
      ]
    });
  },

  selectCounselor: function(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/post/create?counselorId=${id}&counselorName=${name}`
    });
  }
})
