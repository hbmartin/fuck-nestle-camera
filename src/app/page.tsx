import type { Metadata } from "next"
import { MobileCameraView } from "@/components/mobile-camera-view"

export const metadata: Metadata = {
  title: "Fuck Nestlé Camera",
}

export default function Home() {
  return (
    <div className="grid min-h-screen grid-rows-[20px_1fr_20px] items-center justify-items-center gap-16 p-8 pb-20 font-sans sm:p-20">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <MobileCameraView />
      </main>
      <footer className="row-start-3 flex gap-6 flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://www.fucknestle.art"
        >
          Really, fuck Иestlé
        </a>
      </footer>
    </div>
  )
}
