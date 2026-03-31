import { TushareNewsProvider } from './providers/tushareNewsProvider.js';
import { XueqiuNewsProvider } from './providers/xueqiuNewsProvider.js';

const providers = [
  new TushareNewsProvider(),
  new XueqiuNewsProvider(),
];

const providerMap = new Map(
  providers.map((provider) => [provider.getKey(), provider]),
);

export const newsProviderRegistry = {
  list() {
    return providers.map((provider) => ({
      key: provider.getKey(),
      name: provider.getDisplayName(),
    }));
  },

  get(providerKey) {
    return providerMap.get(String(providerKey || '').trim()) || null;
  },
};
