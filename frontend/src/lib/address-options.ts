// Prototype curated address dataset for client-facing quick creation.
// Replace this with a backend address_reference table or an official postal
// dataset when exhaustive address validation is required.

interface CityOption {
  city: string;
  postals: string[];
}

interface StateOption {
  state: string;
  cities: CityOption[];
}

export const countryOptions = [
  { value: "SG", label: "Singapore" },
  { value: "MY", label: "Malaysia" },
] as const;

const addressOptions: Record<string, StateOption[]> = {
  MY: [
    { state: "Johor", cities: [
      { city: "Johor Bahru", postals: ["80000", "80100", "80200"] },
      { city: "Iskandar Puteri", postals: ["79100", "79250"] },
      { city: "Skudai", postals: ["81300"] },
      { city: "Kulai", postals: ["81000"] },
      { city: "Batu Pahat", postals: ["83000"] },
      { city: "Muar", postals: ["84000"] },
    ] },
    { state: "Kuala Lumpur", cities: [
      { city: "Kuala Lumpur", postals: ["50000", "50450", "50480"] },
      { city: "Cheras", postals: ["56000"] },
      { city: "Setapak", postals: ["53300"] },
      { city: "Bukit Bintang", postals: ["55100"] },
    ] },
    { state: "Selangor", cities: [
      { city: "Shah Alam", postals: ["40000", "40100"] },
      { city: "Petaling Jaya", postals: ["46000", "47300"] },
      { city: "Subang Jaya", postals: ["47500"] },
      { city: "Klang", postals: ["41000", "41200"] },
      { city: "Cyberjaya", postals: ["63000"] },
      { city: "Puchong", postals: ["47100"] },
    ] },
    { state: "Penang", cities: [
      { city: "George Town", postals: ["10000", "10200"] },
      { city: "Bayan Lepas", postals: ["11900"] },
      { city: "Butterworth", postals: ["12000"] },
      { city: "Bukit Mertajam", postals: ["14000"] },
    ] },
    { state: "Perak", cities: [{ city: "Ipoh", postals: ["30000", "31400"] }] },
    { state: "Negeri Sembilan", cities: [{ city: "Seremban", postals: ["70000", "70300"] }] },
    { state: "Melaka", cities: [{ city: "Melaka City", postals: ["75000", "75450"] }] },
    { state: "Pahang", cities: [{ city: "Kuantan", postals: ["25000", "25200"] }] },
    { state: "Kedah", cities: [{ city: "Alor Setar", postals: ["05000", "05100"] }] },
    { state: "Kelantan", cities: [{ city: "Kota Bharu", postals: ["15000", "16100"] }] },
    { state: "Terengganu", cities: [{ city: "Kuala Terengganu", postals: ["20000", "21000"] }] },
    { state: "Perlis", cities: [{ city: "Kangar", postals: ["01000"] }] },
    { state: "Sabah", cities: [{ city: "Kota Kinabalu", postals: ["88000", "88300"] }] },
    { state: "Sarawak", cities: [{ city: "Kuching", postals: ["93000", "93300"] }] },
    { state: "Putrajaya", cities: [{ city: "Putrajaya", postals: ["62000", "62500"] }] },
    { state: "Labuan", cities: [{ city: "Labuan", postals: ["87000"] }] },
  ],
  SG: [
    { state: "Central", cities: [
      { city: "Downtown Core", postals: ["018956", "049315"] },
      { city: "Orchard", postals: ["238879", "238858"] },
      { city: "Toa Payoh", postals: ["310190"] },
      { city: "Queenstown", postals: ["149053"] },
    ] },
    { state: "East", cities: [
      { city: "Tampines", postals: ["529536"] },
      { city: "Bedok", postals: ["460207"] },
      { city: "Changi", postals: ["819642"] },
      { city: "Paya Lebar", postals: ["409051"] },
    ] },
    { state: "North", cities: [
      { city: "Woodlands", postals: ["730900"] },
      { city: "Yishun", postals: ["760930"] },
      { city: "Sembawang", postals: ["757713"] },
    ] },
    { state: "North-East", cities: [
      { city: "Ang Mo Kio", postals: ["560560"] },
      { city: "Hougang", postals: ["530205"] },
      { city: "Serangoon", postals: ["550254"] },
      { city: "Punggol", postals: ["820273"] },
    ] },
    { state: "West", cities: [
      { city: "Jurong East", postals: ["609601"] },
      { city: "Clementi", postals: ["120450"] },
      { city: "Bukit Batok", postals: ["650190"] },
      { city: "Tuas", postals: ["638075"] },
    ] },
  ],
};

export function getStateOptions(country: string): string[] {
  return (addressOptions[country] ?? []).map(({ state }) => state);
}

export function getCityOptions(country: string, state: string): string[] {
  return (addressOptions[country] ?? [])
    .find((option) => option.state === state)
    ?.cities.map(({ city }) => city) ?? [];
}

export function getPostalOptions(country: string, state: string, city: string): string[] {
  return (addressOptions[country] ?? [])
    .find((option) => option.state === state)
    ?.cities.find((option) => option.city === city)
    ?.postals ?? [];
}
