import Image from 'next/image';

const QR_URL = 'https://www.ovld.ai/?utm_source=event&utm_campaign=ai-builders-2026-05';
const QR_SRC = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(QR_URL)}&bgcolor=020817&color=ffffff&margin=0`;

export default function Slide01() {
  return (
    <div className="relative flex h-full w-full items-stretch overflow-hidden bg-[#020817] text-white">
      {/* Background radial glow — same as homepage */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(56,189,248,0.12),_transparent_26%)]" />

      {/* Left: logo + name */}
      <div className="relative z-10 flex flex-1 flex-col items-start justify-center px-16 lg:px-24 p1080:px-32 p2k:px-48 p4k:px-64">
        <div className="flex items-center gap-8 p2k:gap-12 p4k:gap-16">
          <Image
            src="/images/256.png"
            alt="Overlord logo"
            width={120}
            height={120}
            className="shrink-0 p2k:w-[180px] p2k:h-[180px] p4k:w-[240px] p4k:h-[240px]"
            priority
          />
          <div className="flex flex-col gap-6 p2k:gap-8">
            <h1 className="font-display text-8xl font-semibold tracking-tight lg:text-9xl p2k:text-[13rem] p4k:text-[18rem]">
              Overlord
            </h1>
            <p className="font-mono text-sm uppercase tracking-widest text-sky-400 p2k:text-2xl p4k:text-4xl">
              ai builders · may 2026
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="relative z-10 w-px self-stretch bg-white/10" />

      {/* Right: QR code */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-16 lg:px-24 p1080:px-32 p2k:px-48 p4k:px-64">
        <img
          src={QR_SRC}
          alt={`QR code linking to ${QR_URL}`}
          width={380}
          height={380}
          className="rounded-2xl p2k:w-[560px] p2k:h-[560px] p4k:w-[760px] p4k:h-[760px]"
        />
      </div>
    </div>
  );
}
