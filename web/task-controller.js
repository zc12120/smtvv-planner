'use strict';
// A single lifecycle owns task identity, cancellation generations and polling.
class TaskController {
  constructor() {
    this.phase='idle';this.revision=0;this.pageRevision=0;this.jobId='';this.request=null;
    this.pollTimer=null;this.completed=null;this.retryObjective='mixed';this.abort=new AbortController();
  }
  get busy() {return ['submitting','queued','running'].includes(this.phase);}
  transition(phase) {
    if (!['idle','submitting','queued','running','completed','failed','cancelled'].includes(phase)) throw Error('Invalid task phase');
    this.phase=phase;
  }
  invalidate() {
    const jobId=this.jobId||this.request?.requestId;
    this.revision++;this.pageRevision++;clearTimeout(this.pollTimer);this.abort.abort();this.abort=new AbortController();
    this.jobId='';this.request=null;this.transition('idle');return jobId;
  }
  receive(result) {
    this.transition(result.finished ? (result.complete?'completed':result.error?'failed':'cancelled') : result.status==='queued'?'queued':'running');
  }
}
window.TaskController=TaskController;
