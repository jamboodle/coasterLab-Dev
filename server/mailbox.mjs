// Local development only: never sends email over the network or writes links to logs.
export class DevelopmentMailbox {
  constructor(){this.messages=[];}
  async send(message){
    this.messages=this.messages.filter(item=>item.createdAt>Date.now()-86400000).slice(0,49);
    this.messages.unshift({...message,createdAt:Date.now()});
  }
  list(){return this.messages.filter(item=>item.createdAt>Date.now()-86400000);}
}
