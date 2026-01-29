// pages/index/index.js
Page({
  data: {
    questions: []
  },

  onLoad: function (options) {
    this.loadQuestions();
  },

  onShow: function() {
    // 每次显示页面时刷新数据（模拟）
    this.loadQuestions();
  },

  loadQuestions: function() {
    // 模拟数据
    const mockQuestions = [
      {
        id: 1,
        content: "最近感觉压力很大，期末考试复习不完怎么办？感觉每天都很焦虑，睡不着觉。",
        time: "2026-01-28 14:30",
        reply: "同学你好，考前焦虑是很正常的现象。建议制定合理的复习计划，按部就班。如果失眠严重，可以来心理咨询室找老师聊聊。",
        isPublic: true
      },
      {
        id: 2,
        content: "请问奖学金评定标准在哪里可以看到？",
        time: "2026-01-29 09:15",
        reply: null,
        isPublic: true
      },
      {
        id: 3,
        content: "宿舍关系处理不好，室友总是半夜打游戏，沟通过也没用。",
        time: "2026-01-29 11:20",
        reply: "这确实很让人困扰。建议可以先找宿管阿姨协调，或者私信辅导员我们一起开个寝室会议。",
        isPublic: true
      }
    ];
    
    this.setData({
      questions: mockQuestions
    });
  },

  goToDetail: function(e) {
    const id = e.currentTarget.dataset.id;
    // 暂时没有详情页，直接提示
    wx.showToast({
      title: '查看详情: ' + id,
      icon: 'none'
    });
  }
})
