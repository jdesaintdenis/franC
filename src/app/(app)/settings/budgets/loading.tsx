import { ManageListSkeleton } from "@/components/manage/manage-list-skeleton";

export default function BudgetsLoading() {
  return <ManageListSkeleton add={false} intro={0} bars />;
}
