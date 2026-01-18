import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { cn } from "../../utils/cn";
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
      </div>

      {/* 新合集按钮 */}
      <button
        onClick={() => setShowCreateModal(true)}
        className={cn(
          "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md transition-all duration-150 cursor-pointer",
          "hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 text-sm",
          "text-slate-600 dark:text-slate-300"
        )}
      >
        <FolderPlus className="w-4 h-4 flex-shrink-0" />
        <span>新合集</span>
      </button>

      {/* 合集列表 */}
      <div className="space-y-0.5 mt-0.5">
        {rootCollections.map((collection) => (
          <CollectionItem
            key={collection.id}
            collection={collection}
            level={0}
            childCollections={collections.filter((c) => c.parent_id === collection.id)}
            allCollections={collections}
            onEdit={handleEdit}
          />
        ))}
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
