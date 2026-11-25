import CivicNavigation from "@/components/CivicNavigation";
import ParkAirQuality from "@/components/ParkAirQuality";

export default function ParksPage() {
  return (
    <>
      <header className="bangkok-ui-font hidden border-b border-neutral-300/70 bg-white px-6 py-4 sm:flex sm:justify-center">
        <CivicNavigation lang="TH" active="parks" />
      </header>
      <ParkAirQuality stations={[]} lang="TH" />
    </>
  );
}

