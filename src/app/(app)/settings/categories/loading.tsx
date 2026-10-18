import { ManageListSkeleton } from "@/components/manage/manage-list-skeleton";

export default function CategoriesLoading() {
  return <ManageListSkeleton add={false} intro={1} rows={4} />;
}
