// Static airport reference (IATA code -> name/lat/lon), curated from the public
// OpenFlights airports.dat dataset (columns: IATA, name, lat, lon). Covers major
// US + international hubs plus destinations implied by the historical trip data.
// If a code is not present, the UI lets the user enter a distance manually.

export interface Airport { code: string; name: string; lat: number; lon: number; }

export const AIRPORTS: Airport[] = [
  { code: 'ATL', name: 'Hartsfield-Jackson Atlanta Intl', lat: 33.6367, lon: -84.4281 },
  { code: 'SEA', name: 'Seattle-Tacoma Intl', lat: 47.4490, lon: -122.3093 },
  { code: 'PDX', name: 'Portland Intl', lat: 45.5887, lon: -122.5975 },
  { code: 'SFO', name: 'San Francisco Intl', lat: 37.6189, lon: -122.3750 },
  { code: 'SJC', name: 'Norman Y. Mineta San Jose Intl', lat: 37.3626, lon: -121.9291 },
  { code: 'OAK', name: 'Oakland Intl', lat: 37.7213, lon: -122.2207 },
  { code: 'LAX', name: 'Los Angeles Intl', lat: 33.9425, lon: -118.4081 },
  { code: 'SAN', name: 'San Diego Intl', lat: 32.7336, lon: -117.1897 },
  { code: 'DEN', name: 'Denver Intl', lat: 39.8617, lon: -104.6732 },
  { code: 'ORD', name: "Chicago O'Hare Intl", lat: 41.9786, lon: -87.9048 },
  { code: 'MDW', name: 'Chicago Midway Intl', lat: 41.7860, lon: -87.7524 },
  { code: 'DCA', name: 'Ronald Reagan Washington National', lat: 38.8521, lon: -77.0377 },
  { code: 'IAD', name: 'Washington Dulles Intl', lat: 38.9445, lon: -77.4558 },
  { code: 'BWI', name: 'Baltimore/Washington Intl', lat: 39.1754, lon: -76.6683 },
  { code: 'JFK', name: 'New York John F. Kennedy Intl', lat: 40.6398, lon: -73.7789 },
  { code: 'LGA', name: 'New York LaGuardia', lat: 40.7772, lon: -73.8726 },
  { code: 'EWR', name: 'Newark Liberty Intl', lat: 40.6925, lon: -74.1687 },
  { code: 'BOS', name: 'Boston Logan Intl', lat: 42.3643, lon: -71.0052 },
  { code: 'PHL', name: 'Philadelphia Intl', lat: 39.8719, lon: -75.2411 },
  { code: 'MIA', name: 'Miami Intl', lat: 25.7932, lon: -80.2906 },
  { code: 'MCO', name: 'Orlando Intl', lat: 28.4294, lon: -81.3089 },
  { code: 'TPA', name: 'Tampa Intl', lat: 27.9755, lon: -82.5332 },
  { code: 'FLL', name: 'Fort Lauderdale-Hollywood Intl', lat: 26.0726, lon: -80.1527 },
  { code: 'DFW', name: 'Dallas/Fort Worth Intl', lat: 32.8968, lon: -97.0380 },
  { code: 'IAH', name: 'Houston George Bush Intercontinental', lat: 29.9844, lon: -95.3414 },
  { code: 'AUS', name: 'Austin-Bergstrom Intl', lat: 30.1945, lon: -97.6699 },
  { code: 'PHX', name: 'Phoenix Sky Harbor Intl', lat: 33.4343, lon: -112.0116 },
  { code: 'LAS', name: 'Harry Reid Intl (Las Vegas)', lat: 36.0840, lon: -115.1537 },
  { code: 'SLC', name: 'Salt Lake City Intl', lat: 40.7884, lon: -111.9778 },
  { code: 'MSP', name: 'Minneapolis-St Paul Intl', lat: 44.8820, lon: -93.2218 },
  { code: 'DTW', name: 'Detroit Metro Wayne County', lat: 42.2124, lon: -83.3534 },
  { code: 'CLT', name: 'Charlotte Douglas Intl', lat: 35.2140, lon: -80.9431 },
  { code: 'RDU', name: 'Raleigh-Durham Intl', lat: 35.8776, lon: -78.7875 },
  { code: 'BNA', name: 'Nashville Intl', lat: 36.1245, lon: -86.6782 },
  { code: 'TYS', name: 'McGhee Tyson (Knoxville)', lat: 35.8110, lon: -83.9940 },
  { code: 'MSY', name: 'New Orleans Louis Armstrong Intl', lat: 29.9934, lon: -90.2580 },
  { code: 'SMF', name: 'Sacramento Intl', lat: 38.6954, lon: -121.5908 },
  { code: 'SAC', name: 'Sacramento Executive', lat: 38.5125, lon: -121.4930 },
  { code: 'RNO', name: 'Reno-Tahoe Intl', lat: 39.4991, lon: -119.7681 },
  { code: 'HNL', name: 'Daniel K. Inouye Intl (Honolulu)', lat: 21.3187, lon: -157.9224 },
  { code: 'OGG', name: 'Kahului (Maui)', lat: 20.8986, lon: -156.4304 },
  { code: 'KOA', name: 'Ellison Onizuka Kona Intl', lat: 19.7388, lon: -156.0456 },
  { code: 'ANC', name: 'Ted Stevens Anchorage Intl', lat: 61.1743, lon: -149.9962 },
  { code: 'SNA', name: 'John Wayne (Orange County)', lat: 33.6757, lon: -117.8682 },
  { code: 'BUR', name: 'Hollywood Burbank', lat: 34.2007, lon: -118.3587 },
  { code: 'PSP', name: 'Palm Springs Intl', lat: 33.8297, lon: -116.5067 },
  { code: 'ABQ', name: 'Albuquerque Intl Sunport', lat: 35.0402, lon: -106.6092 },
  { code: 'PIT', name: 'Pittsburgh Intl', lat: 40.4915, lon: -80.2329 },
  { code: 'CLE', name: 'Cleveland Hopkins Intl', lat: 41.4117, lon: -81.8498 },
  { code: 'CVG', name: 'Cincinnati/Northern Kentucky Intl', lat: 39.0489, lon: -84.6678 },
  { code: 'IND', name: 'Indianapolis Intl', lat: 39.7173, lon: -86.2944 },
  { code: 'CMH', name: 'John Glenn Columbus Intl', lat: 39.9980, lon: -82.8919 },
  { code: 'STL', name: 'St. Louis Lambert Intl', lat: 38.7487, lon: -90.3700 },
  { code: 'MCI', name: 'Kansas City Intl', lat: 39.2976, lon: -94.7139 },
  { code: 'SAT', name: 'San Antonio Intl', lat: 29.5337, lon: -98.4698 },
  { code: 'PBI', name: 'Palm Beach Intl', lat: 26.6832, lon: -80.0956 },
  { code: 'JAX', name: 'Jacksonville Intl', lat: 30.4941, lon: -81.6879 },
  { code: 'RSW', name: 'Southwest Florida Intl (Fort Myers)', lat: 26.5362, lon: -81.7552 },
  { code: 'ORF', name: 'Norfolk Intl', lat: 36.8946, lon: -76.2012 },
  { code: 'RIC', name: 'Richmond Intl', lat: 37.5052, lon: -77.3197 },
  { code: 'ROC', name: 'Greater Rochester Intl', lat: 43.1189, lon: -77.6724 },
  { code: 'BUF', name: 'Buffalo Niagara Intl', lat: 42.9405, lon: -78.7322 },
  { code: 'ALB', name: 'Albany Intl', lat: 42.7483, lon: -73.8017 },
  { code: 'PVD', name: 'Rhode Island T.F. Green Intl', lat: 41.7326, lon: -71.4204 },
  { code: 'BDL', name: 'Bradley Intl (Hartford)', lat: 41.9389, lon: -72.6832 },
  { code: 'MKE', name: 'Milwaukee Mitchell Intl', lat: 42.9472, lon: -87.8966 },
  { code: 'OMA', name: 'Omaha Eppley Airfield', lat: 41.3032, lon: -95.8941 },
  { code: 'BOI', name: 'Boise Airport', lat: 43.5644, lon: -116.2228 },
  { code: 'GEG', name: 'Spokane Intl', lat: 47.6199, lon: -117.5338 },
  { code: 'MSN', name: 'Dane County Regional (Madison)', lat: 43.1399, lon: -89.3375 },
  { code: 'LHR', name: 'London Heathrow', lat: 51.4700, lon: -0.4543 },
  { code: 'LGW', name: 'London Gatwick', lat: 51.1537, lon: -0.1821 },
  { code: 'CDG', name: 'Paris Charles de Gaulle', lat: 49.0097, lon: 2.5479 },
  { code: 'AMS', name: 'Amsterdam Schiphol', lat: 52.3105, lon: 4.7683 },
  { code: 'FRA', name: 'Frankfurt am Main', lat: 50.0379, lon: 8.5622 },
  { code: 'MUC', name: 'Munich', lat: 48.3538, lon: 11.7861 },
  { code: 'TXL', name: 'Berlin Tegel', lat: 52.5597, lon: 13.2877 },
  { code: 'BER', name: 'Berlin Brandenburg', lat: 52.3667, lon: 13.5033 },
  { code: 'FCO', name: 'Rome Fiumicino', lat: 41.8003, lon: 12.2389 },
  { code: 'MAD', name: 'Madrid Barajas', lat: 40.4936, lon: -3.5668 },
  { code: 'BCN', name: 'Barcelona El Prat', lat: 41.2971, lon: 2.0785 },
  { code: 'DUB', name: 'Dublin', lat: 53.4213, lon: -6.2701 },
  { code: 'ZRH', name: 'Zurich', lat: 47.4647, lon: 8.5492 },
  { code: 'CPH', name: 'Copenhagen Kastrup', lat: 55.6180, lon: 12.6560 },
  { code: 'NRT', name: 'Tokyo Narita', lat: 35.7647, lon: 140.3863 },
  { code: 'HND', name: 'Tokyo Haneda', lat: 35.5523, lon: 139.7798 },
  { code: 'HKG', name: 'Hong Kong Intl', lat: 22.3080, lon: 113.9185 },
  { code: 'SIN', name: 'Singapore Changi', lat: 1.3502, lon: 103.9944 },
  { code: 'SYD', name: 'Sydney Kingsford Smith', lat: -33.9461, lon: 151.1772 },
  { code: 'YYZ', name: 'Toronto Pearson Intl', lat: 43.6772, lon: -79.6306 },
  { code: 'YVR', name: 'Vancouver Intl', lat: 49.1939, lon: -123.1844 },
  { code: 'MEX', name: 'Mexico City Intl', lat: 19.4363, lon: -99.0721 },
  { code: 'CUN', name: 'Cancun Intl', lat: 21.0365, lon: -86.8771 },
];

const BY_CODE: Record<string, Airport> = Object.fromEntries(
  AIRPORTS.map(a => [a.code, a])
);

export function lookupAirport(code: string): Airport | null {
  if (!code) return null;
  return BY_CODE[code.trim().toUpperCase()] ?? null;
}

/** Great-circle (haversine) distance in statute miles between two IATA codes. */
export function haversineMiles(a: string, b: string): number | null {
  const A = lookupAirport(a);
  const B = lookupAirport(b);
  if (!A || !B) return null;
  const R = 3958.7613; // Earth radius in statute miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(B.lat - A.lat);
  const dLon = toRad(B.lon - A.lon);
  const lat1 = toRad(A.lat);
  const lat2 = toRad(B.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(h))));
}
