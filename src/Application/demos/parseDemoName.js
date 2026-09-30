// 从查询字符串解析 demo 名。抽为纯函数：零依赖、可单测。
//
// 约定（详见 docs/app-structure.md）：
// - 参数名固定为 demo，其值即 demo 名；缺失或空值返回 ''（视为未指定）。
// - trim + toLowerCase：避免 `?demo=Map-Icon` 静默失灵。
// - 用 URLSearchParams 取指定键，不受同一 URL 上其他查询参数干扰。
export const parseDemoName = (search) => {
  const value = new URLSearchParams(search).get('demo') || '';
  return value.trim().toLowerCase();
};
