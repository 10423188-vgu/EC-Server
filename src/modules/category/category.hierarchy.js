import { BadRequestError } from "../../shared/errors/app.error.js";

export const validateCategoryParent = async (tx, id, parentId) => {
  // why: serialize hierarchy changes so concurrent A -> B and B -> A cannot
  // both validate against an old tree and commit a cycle.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(824617)`;
  if (!parentId) return;
  const categories = await tx.category.findMany({
    select: { id: true, parentId: true },
  });
  const parents = new Map(categories.map((row) => [row.id, row.parentId]));
  if (!parents.has(parentId))
    throw new BadRequestError("Parent category not found");
  const visited = new Set(id ? [id] : []);
  let current = parentId;
  while (current) {
    if (visited.has(current)) {
      throw new BadRequestError(
        "A category cannot be its own parent or belong to its descendants",
      );
    }
    visited.add(current);
    current = parents.get(current);
  }
};
