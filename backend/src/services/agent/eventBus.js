const EventEmitter = require('events');

class ReviewEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(100);
  }

  emitProgress(reviewId, stage, percent, message, data = {}) {
    const payload = {
      reviewId,
      stage,
      percent,
      message,
      data,
      timestamp: new Date().toISOString()
    };
    this.emit(`progress:${reviewId}`, payload);
    this.emit('global_progress', payload);
  }
}

const eventBus = new ReviewEventBus();

module.exports = eventBus;

