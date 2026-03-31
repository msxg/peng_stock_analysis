class TaskStream {
  constructor() {
    this.clients = new Set();
  }

  subscribe(res) {
    this.clients.add(res);
    this.sendTo(res, 'connected', { ok: true, timestamp: new Date().toISOString() });
  }

  unsubscribe(res) {
    this.clients.delete(res);
  }

  sendTo(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  publish(event, data) {
    this.clients.forEach((client) => this.sendTo(client, event, data));
  }

  keepAlive() {
    this.clients.forEach((client) => {
      client.write(': ping\n\n');
    });
  }
}

export const taskStream = new TaskStream();

setInterval(() => {
  taskStream.keepAlive();
}, 15000);
