import { useState } from "react";
import { FolderPlus, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "../../utils/cn";
import { useApp } from "../../context/AppContext";
import { CollectionItem } from "./CollectionItem";
import { CreateCollectionModal } from "./CreateCollectionModal";
import type { Collection } from "../../types";

interface SortableCollectionProps {
  collection: Collection;
  childCollections: Collection[];
  allCollections: Collection[];
  onEdit: (collection: Collection) => void;
}

function SortableCollection({ collection, childCollections, allCollections, onEdit }: SortableCollectionProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={cn("relative group pl-4", isDragging && "opacity-50 z-50")}>
      <div
        {...attributes}
        {...listeners}
        className={cn(
          "absolute left-0 top-1.5 p-0.5 rounded cursor-grab z-10",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        )}
      >
        <GripVertical className="w-3 h-3" />
      </div>
      <CollectionItem
        collection={collection}
        level={0}
        childCollections={childCollections}
        allCollections={allCollections}
        onEdit={onEdit}
      />
    </div>
  );
}

export function CollectionSection() {
  const { collections, updateCollectionsOrder } = useApp();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = rootCollections.findIndex((c) => c.id === active.id);
    const newIndex = rootCollections.findIndex((c) => c.id === over.id);
    const newOrder = arrayMove(rootCollections, oldIndex, newIndex);

    try {
      await updateCollectionsOrder(newOrder.map((c) => c.id));
    } catch (error) {
      console.error("Failed to update collections order:", error);
    }
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
          "w-full flex items-center gap-2.5 px-2 py-1.5 pl-6 rounded-md transition-all duration-150 cursor-pointer",
          "hover:bg-slate-100/80 dark:hover:bg-vnote-hover/80 text-sm",
          "text-slate-600 dark:text-slate-300"
        )}
      >
        <FolderPlus className="w-4 h-4 flex-shrink-0" />
        <span>新合集</span>
      </button>

      {/* 合集列表 */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rootCollections.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-0.5 mt-0.5">
            {rootCollections.map((collection) => (
              <SortableCollection
                key={collection.id}
                collection={collection}
                childCollections={collections.filter((c) => c.parent_id === collection.id)}
                allCollections={collections}
                onEdit={handleEdit}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

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
