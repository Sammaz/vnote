import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { CollectionItem } from "./CollectionItem";
import { CreateCollectionModal } from "./CreateCollectionModal";
import type { Collection } from "../../types";

export function CollectionSection() {
  const { collections } = useApp();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);

  // 获取根合集（没有父级的）
  const rootCollections = collections.filter((c) => c.parent_id === null);

  const handleEdit = (collection: Collection) => {
    setEditingCollection(collection);
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingCollection(null);
  };

  return (
    <div>
      {/* 标题区域 */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
          合集
        </span>
        <button
          onClick={() => setShowCreateModal(true)}
          className="p-1 rounded-md hover:bg-slate-100 dark:hover:bg-vnote-hover transition-colors cursor-pointer"
          title="新建合集"
        >
          <Plus className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" />
        </button>
      </div>

      {/* 合集列表 */}
      <div className="space-y-0.5">
        {rootCollections.length > 0 ? (
          rootCollections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              level={0}
              childCollections={collections.filter((c) => c.parent_id === collection.id)}
              allCollections={collections}
              onEdit={handleEdit}
            />
          ))
        ) : (
          <div className="px-2 py-3 text-xs text-slate-400 dark:text-slate-500 text-center">
            暂无合集，点击 + 创建
          </div>
        )}
      </div>

      {/* 创建/编辑合集弹窗 */}
      {showCreateModal && (
        <CreateCollectionModal
          onClose={handleCloseModal}
          editingCollection={editingCollection}
        />
      )}
    </div>
  );
}
