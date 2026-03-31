import { focusNewsService } from '../services/focusNewsService.js';
import { focusNewsOpsService } from '../services/focusNewsOpsService.js';

export const focusNewsController = {
  providers(_req, res) {
    res.json({
      items: focusNewsService.listProviders(),
    });
  },

  categories(req, res) {
    res.json({
      items: focusNewsService.listProviderCategories({
        providerKey: req.query.providerKey,
      }),
    });
  },

  taxonomies(_req, res) {
    res.json({
      items: focusNewsService.listTaxonomies(),
    });
  },

  mappings(req, res) {
    res.json({
      items: focusNewsService.listTaxonomyMappings({
        providerKey: req.query.providerKey,
      }),
    });
  },

  runs(req, res) {
    res.json({
      items: focusNewsService.listSyncRuns({
        providerKey: req.query.providerKey,
        limit: req.query.limit,
        triggerType: req.query.triggerType,
        status: req.query.status,
      }),
    });
  },

  items(req, res) {
    res.json(focusNewsService.listItems({
      providerKey: req.query.providerKey,
      categoryKey: req.query.categoryKey,
      q: req.query.q,
      page: req.query.page,
      limit: req.query.limit,
    }));
  },

  itemDetail(req, res) {
    res.json({
      item: focusNewsService.getItemDetail({
        newsUid: req.params.newsUid,
        id: req.query.id,
      }),
    });
  },

  async syncCatalog(req, res) {
    const payload = await focusNewsService.syncCatalog(req.body || {});
    res.json(payload);
  },

  async syncItems(req, res) {
    const payload = await focusNewsService.syncItems(req.body || {});
    res.json(payload);
  },

  schedulerStatus(req, res) {
    res.json(focusNewsOpsService.schedulerStatus({
      providerKey: req.query.providerKey,
      limit: req.query.limit,
    }));
  },

  schedulerCategories(req, res) {
    res.json(focusNewsOpsService.schedulerCategories({
      providerKey: req.query.providerKey,
      level: req.query.level,
    }));
  },

  schedulerCategoryPolicy(req, res) {
    res.json(focusNewsOpsService.schedulerCategoryPolicy({
      providerKey: req.body?.providerKey || req.query?.providerKey,
      categoryKey: req.params.categoryKey,
      schedulerEnabled: req.body?.schedulerEnabled,
      schedulerPriority: req.body?.schedulerPriority,
    }));
  },

  async schedulerRun(req, res) {
    res.json(await focusNewsOpsService.schedulerRun(req.body || {}));
  },
};
