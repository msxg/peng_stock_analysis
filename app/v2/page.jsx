export const metadata = {
  title: 'Peng Admin (Parity UI)',
  description: '与老版本保持功能与布局一致的 Next 重构基线页面',
};

export default function V2ParityPage() {
  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      <iframe
        src="/legacy-ui.html"
        title="Peng Admin Parity UI"
        className="h-full w-full border-0"
      />
    </div>
  );
}
