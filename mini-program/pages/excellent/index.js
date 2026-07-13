const api=require("../../utils/api");Page({data:{items:[]},onShow(){api.request("/api/mini/excellent").then(d=>this.setData({items:d.items||[]})).catch(()=>this.setData({items:[]}))}})
