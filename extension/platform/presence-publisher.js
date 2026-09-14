import { discordPresence } from '../discord/presence.js';

export const presencePublisher = Object.freeze({
  initialize() {
    return discordPresence.initialize();
  },

  status() {
    return discordPresence.status();
  },

  publish(intent, applicationId) {
    return discordPresence.publish(intent, applicationId);
  },

  connect() {
    return discordPresence.connect();
  },

  disconnect() {
    return discordPresence.disconnect();
  },

  configure(clientId) {
    return discordPresence.configure(clientId);
  },

  setup() {
    return discordPresence.getSetup();
  },

  renew() {
    return discordPresence.renew();
  },
});
