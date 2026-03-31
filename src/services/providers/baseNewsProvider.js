import { HttpError } from '../../utils/httpError.js';

export class BaseNewsProvider {
  getKey() {
    throw new HttpError(500, 'provider key 未实现');
  }

  getDisplayName() {
    return this.getKey();
  }

  async pullCatalog() {
    throw new HttpError(500, `${this.getKey()} 未实现 pullCatalog`);
  }

  async pullItems(_params = {}) {
    throw new HttpError(500, `${this.getKey()} 未实现 pullItems`);
  }

  normalizeCategory(sourceCategory = {}) {
    const providerKey = this.getKey();
    return {
      providerKey,
      categoryKey: String(sourceCategory.categoryKey || '').trim(),
      parentCategoryKey: String(sourceCategory.parentCategoryKey || '').trim() || null,
      name: String(sourceCategory.name || '').trim(),
      level: Number(sourceCategory.level || 1),
      sortOrder: Number(sourceCategory.sortOrder || 100),
      isActive: sourceCategory.isActive !== false,
      meta: sourceCategory.meta || {},
    };
  }

  normalizeItem(sourceItem = {}) {
    return sourceItem;
  }
}
