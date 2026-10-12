// Real city + ZIP ranges for seeded service addresses, so a customer of a city utility lives in that city
// with a ZIP that belongs to it (not the state capital with a random in-state ZIP).
// Ranges are inclusive five-digit spans inside the city's own ZIP codes.

// State fallback: capital city with a ZIP range inside that capital.
export const CAPITALS = {
  AL: ['Montgomery', 36104, 36117], AK: ['Juneau', 99801, 99803], AZ: ['Phoenix', 85003, 85054], AR: ['Little Rock', 72201, 72227], CA: ['Sacramento', 95811, 95838],
  CO: ['Denver', 80202, 80239], CT: ['Hartford', 6103, 6120], DE: ['Dover', 19901, 19904], DC: ['Washington', 20001, 20020], FL: ['Tallahassee', 32301, 32317],
  GA: ['Atlanta', 30303, 30342], HI: ['Honolulu', 96813, 96826], ID: ['Boise', 83702, 83716], IL: ['Springfield', 62701, 62712], IN: ['Indianapolis', 46201, 46260],
  IA: ['Des Moines', 50309, 50321], KS: ['Topeka', 66603, 66619], KY: ['Frankfort', 40601, 40601], LA: ['Baton Rouge', 70801, 70820], ME: ['Augusta', 4330, 4330],
  MD: ['Annapolis', 21401, 21409], MA: ['Boston', 2108, 2136], MI: ['Lansing', 48906, 48917], MN: ['Saint Paul', 55101, 55119], MS: ['Jackson', 39201, 39216],
  MO: ['Jefferson City', 65101, 65109], MT: ['Helena', 59601, 59602], NE: ['Lincoln', 68502, 68528], NV: ['Carson City', 89701, 89706], NH: ['Concord', 3301, 3303],
  NJ: ['Trenton', 8608, 8619], NM: ['Santa Fe', 87501, 87508], NY: ['Albany', 12203, 12210], NC: ['Raleigh', 27601, 27617], ND: ['Bismarck', 58501, 58504],
  OH: ['Columbus', 43201, 43235], OK: ['Oklahoma City', 73102, 73132], OR: ['Salem', 97301, 97306], PA: ['Harrisburg', 17101, 17112], RI: ['Providence', 2903, 2909],
  SC: ['Columbia', 29201, 29212], SD: ['Pierre', 57501, 57501], TN: ['Nashville', 37203, 37221], TX: ['Austin', 78701, 78759], UT: ['Salt Lake City', 84101, 84121],
  VT: ['Montpelier', 5602, 5602], VA: ['Richmond', 23219, 23235], WA: ['Olympia', 98501, 98516], WV: ['Charleston', 25301, 25314], WI: ['Madison', 53703, 53726],
  WY: ['Cheyenne', 82001, 82009], PR: ['San Juan', 901, 926], GU: ['Hagåtña', 96910, 96910], VI: ['Charlotte Amalie', 802, 802], AS: ['Pago Pago', 96799, 96799], MP: ['Saipan', 96950, 96950]
};

// [state, city, zipLo, zipHi, extra match pattern (optional)]. The city name itself always matches (word-bounded).
export const CITIES = [
  ['AL', 'Birmingham', 35203, 35235], ['AL', 'Huntsville', 35801, 35816], ['AL', 'Mobile', 36602, 36619], ['AL', 'Tuscaloosa', 35401, 35406],
  ['AZ', 'Tucson', 85701, 85750], ['AZ', 'Mesa', 85201, 85215], ['AZ', 'Scottsdale', 85250, 85262], ['AZ', 'Chandler', 85224, 85226], ['AZ', 'Glendale', 85301, 85310], ['AZ', 'Tempe', 85281, 85284],
  ['CA', 'Los Angeles', 90001, 90068, /\bLADWP\b|\bL\.?A\.? (?:city|county)\b/i], ['CA', 'San Francisco', 94102, 94134], ['CA', 'San Diego', 92101, 92131], ['CA', 'San Jose', 95110, 95136],
  ['CA', 'Oakland', 94601, 94621, /\bEBMUD\b|\bEast Bay\b|\bAlameda\b/i], ['CA', 'Berkeley', 94702, 94710], ['CA', 'Fresno', 93701, 93730], ['CA', 'Long Beach', 90802, 90815],
  ['CA', 'Riverside', 92501, 92509], ['CA', 'San Bernardino', 92401, 92410, /\bInland Empire\b/i], ['CA', 'Fontana', 92335, 92337], ['CA', 'Rialto', 92376, 92377], ['CA', 'Anaheim', 92801, 92807],
  ['CA', 'Santa Ana', 92701, 92707], ['CA', 'Irvine', 92602, 92620], ['CA', 'Bakersfield', 93301, 93314], ['CA', 'Stockton', 95202, 95212], ['CA', 'Pasadena', 91101, 91107],
  ['CA', 'Pomona', 91766, 91768], ['CA', 'Santa Rosa', 95401, 95409], ['CA', 'Santa Clarita', 91350, 91355], ['CA', 'Rancho Cucamonga', 91701, 91739], ['CA', 'Thousand Oaks', 91360, 91362],
  ['CA', 'Mountain View', 94040, 94043], ['CA', 'San Gabriel', 91775, 91776], ['CA', 'Modesto', 95350, 95358], ['CA', 'Chula Vista', 91910, 91915],
  ['CO', 'Colorado Springs', 80903, 80920], ['CO', 'Aurora', 80010, 80019], ['CO', 'Fort Collins', 80521, 80528], ['CO', 'Boulder', 80301, 80305],
  ['CT', 'New Haven', 6510, 6515], ['CT', 'Bridgeport', 6604, 6610], ['CT', 'Stamford', 6901, 6907],
  ['DC', 'Washington', 20001, 20020, /\bDistrict of Columbia\b|\bDC Water\b/i],
  ['FL', 'Jacksonville', 32202, 32258, /\bJEA\b|\bDuval\b/i], ['FL', 'Miami', 33125, 33189, /\bMiami-Dade\b/i], ['FL', 'Tampa', 33602, 33629, /\bHillsborough\b/i], ['FL', 'Orlando', 32801, 32839, /\bOrange County\b/i],
  ['FL', 'St. Petersburg', 33701, 33716, /\bSt\.? Petersburg\b|\bPinellas\b/i], ['FL', 'Fort Lauderdale', 33301, 33316, /\bBroward\b/i], ['FL', 'West Palm Beach', 33401, 33417, /\bPalm Beach\b/i],
  ['FL', 'Gainesville', 32601, 32609], ['FL', 'Pensacola', 32501, 32514], ['FL', 'Cape Coral', 33904, 33914], ['FL', 'Hialeah', 33010, 33016],
  ['GA', 'Savannah', 31401, 31419], ['GA', 'Augusta', 30901, 30909], ['GA', 'Columbus', 31901, 31909], ['GA', 'Macon', 31201, 31217], ['GA', 'Athens', 30601, 30606],
  ['HI', 'Hilo', 96720, 96720],
  ['ID', 'Idaho Falls', 83401, 83406], ['ID', 'Meridian', 83642, 83646], ['ID', 'Nampa', 83651, 83687],
  ['IL', 'Chicago', 60601, 60661], ['IL', 'Aurora', 60502, 60506], ['IL', 'Naperville', 60540, 60565], ['IL', 'Joliet', 60431, 60436], ['IL', 'Rockford', 61101, 61114], ['IL', 'Peoria', 61602, 61615],
  ['IL', 'Elgin', 60120, 60124], ['IL', 'Champaign', 61820, 61822], ['IL', 'Evanston', 60201, 60208],
  ['IN', 'Fort Wayne', 46802, 46835], ['IN', 'Evansville', 47708, 47725], ['IN', 'South Bend', 46601, 46637], ['IN', 'Carmel', 46032, 46033], ['IN', 'Bloomington', 47401, 47408],
  ['IA', 'Cedar Rapids', 52401, 52411], ['IA', 'Davenport', 52801, 52807], ['IA', 'Sioux City', 51101, 51111], ['IA', 'Iowa City', 52240, 52246],
  ['KS', 'Wichita', 67202, 67235], ['KS', 'Overland Park', 66204, 66223], ['KS', 'Kansas City', 66101, 66112], ['KS', 'Olathe', 66061, 66062], ['KS', 'Lawrence', 66044, 66049],
  ['KY', 'Louisville', 40202, 40245], ['KY', 'Lexington', 40502, 40517], ['KY', 'Bowling Green', 42101, 42104], ['KY', 'Covington', 41011, 41017],
  ['LA', 'New Orleans', 70112, 70131], ['LA', 'Shreveport', 71101, 71119], ['LA', 'Lafayette', 70501, 70508],
  ['MD', 'Baltimore', 21201, 21231], ['MD', 'Rockville', 20850, 20853, /\bMontgomery County\b|\bWSSC\b/i], ['MD', 'Frederick', 21701, 21704],
  ['MA', 'Worcester', 1602, 1610], ['MA', 'Springfield', 1103, 1129], ['MA', 'Cambridge', 2138, 2142], ['MA', 'Lowell', 1850, 1854],
  ['MI', 'Detroit', 48201, 48235], ['MI', 'Grand Rapids', 49503, 49548], ['MI', 'Ann Arbor', 48103, 48109], ['MI', 'Flint', 48502, 48507], ['MI', 'Warren', 48088, 48093],
  ['MN', 'Minneapolis', 55401, 55419], ['MN', 'Rochester', 55901, 55906], ['MN', 'Duluth', 55802, 55812], ['MN', 'Bloomington', 55420, 55438],
  ['MS', 'Gulfport', 39501, 39507], ['MS', 'Hattiesburg', 39401, 39402],
  ['MO', 'Kansas City', 64105, 64138], ['MO', 'St. Louis', 63101, 63139, /\bSt\.? Louis\b|\bSaint Louis\b/i], ['MO', 'Springfield', 65802, 65810], ['MO', 'Columbia', 65201, 65203], ['MO', 'Independence', 64050, 64058],
  ['MT', 'Billings', 59101, 59106], ['MT', 'Missoula', 59801, 59808],
  ['NE', 'Omaha', 68102, 68164],
  ['NV', 'Las Vegas', 89101, 89149, /\bClark County\b|\bLas Vegas Valley\b/i], ['NV', 'Henderson', 89002, 89015], ['NV', 'Reno', 89501, 89523],
  ['NJ', 'Newark', 7102, 7114], ['NJ', 'Jersey City', 7302, 7307], ['NJ', 'Paterson', 7501, 7514], ['NJ', 'Camden', 8102, 8105],
  ['NM', 'Albuquerque', 87102, 87123, /\bBernalillo\b/i], ['NM', 'Las Cruces', 88001, 88012],
  ['NY', 'New York', 10001, 10040, /\bNew York City\b|\bNYC\b|\bfive boroughs\b|\bManhattan\b/i], ['NY', 'Brooklyn', 11201, 11238], ['NY', 'Buffalo', 14201, 14222, /\bErie County\b/i],
  ['NY', 'Rochester', 14604, 14626, /\bMonroe County\b/i], ['NY', 'Syracuse', 13202, 13224, /\bOnondaga\b/i], ['NY', 'Yonkers', 10701, 10710],
  ['NY', 'Hauppauge', 11788, 11788, /\bSuffolk County\b|\bSCWA\b/i], ['NY', 'Mineola', 11501, 11501, /\bNassau County\b/i], ['NY', 'Long Island City', 11101, 11106],
  ['NC', 'Charlotte', 28202, 28277, /\bMecklenburg\b/i], ['NC', 'Greensboro', 27401, 27410], ['NC', 'Durham', 27701, 27713], ['NC', 'Winston-Salem', 27101, 27127], ['NC', 'Fayetteville', 28301, 28314],
  ['NC', 'Wilmington', 28401, 28412], ['NC', 'Asheville', 28801, 28806], ['NC', 'Cary', 27511, 27519],
  ['ND', 'Fargo', 58102, 58104], ['ND', 'Grand Forks', 58201, 58203],
  ['OH', 'Cleveland', 44102, 44135], ['OH', 'Cincinnati', 45202, 45249], ['OH', 'Toledo', 43604, 43623], ['OH', 'Akron', 44301, 44320], ['OH', 'Dayton', 45402, 45420],
  ['OH', 'Youngstown', 44502, 44512], ['OH', 'Canton', 44702, 44714],
  ['OK', 'Tulsa', 74103, 74137], ['OK', 'Norman', 73069, 73072], ['OK', 'Broken Arrow', 74011, 74014],
  ['OR', 'Portland', 97201, 97236], ['OR', 'Eugene', 97401, 97405], ['OR', 'Gresham', 97030, 97080], ['OR', 'Bend', 97701, 97703], ['OR', 'Ashland', 97520, 97520],
  ['PA', 'Philadelphia', 19102, 19154], ['PA', 'Pittsburgh', 15201, 15237, /\bAllegheny\b/i], ['PA', 'Allentown', 18101, 18109], ['PA', 'Erie', 16501, 16511], ['PA', 'Reading', 19601, 19611],
  ['PA', 'Scranton', 18503, 18510], ['PA', 'Lancaster', 17601, 17603],
  ['RI', 'Warwick', 2886, 2889], ['RI', 'Cranston', 2905, 2921],
  ['SC', 'Charleston', 29401, 29414], ['SC', 'Greenville', 29601, 29617], ['SC', 'Myrtle Beach', 29572, 29579],
  ['SD', 'Sioux Falls', 57103, 57110], ['SD', 'Rapid City', 57701, 57703],
  ['TN', 'Memphis', 38103, 38141, /\bMLGW\b|\bShelby County\b/i], ['TN', 'Knoxville', 37902, 37938], ['TN', 'Chattanooga', 37402, 37421], ['TN', 'Clarksville', 37040, 37043], ['TN', 'Murfreesboro', 37127, 37130],
  ['TX', 'Houston', 77002, 77099, /\bHarris County\b/i], ['TX', 'Dallas', 75201, 75254], ['TX', 'San Antonio', 78201, 78258, /\bSAWS\b|\bBexar\b/i], ['TX', 'Fort Worth', 76102, 76137, /\bTarrant\b/i],
  ['TX', 'El Paso', 79901, 79938], ['TX', 'Arlington', 76010, 76018], ['TX', 'Corpus Christi', 78401, 78418], ['TX', 'Plano', 75023, 75094], ['TX', 'Lubbock', 79401, 79424],
  ['TX', 'Laredo', 78040, 78046], ['TX', 'Irving', 75038, 75063], ['TX', 'Garland', 75040, 75044], ['TX', 'Frisco', 75033, 75036], ['TX', 'McKinney', 75069, 75072],
  ['TX', 'Amarillo', 79101, 79124], ['TX', 'Brownsville', 78520, 78526], ['TX', 'Killeen', 76541, 76549], ['TX', 'Waco', 76701, 76712], ['TX', 'Round Rock', 78664, 78681],
  ['UT', 'Provo', 84601, 84606], ['UT', 'West Valley City', 84119, 84128], ['UT', 'Ogden', 84401, 84405], ['UT', 'St. George', 84770, 84790],
  ['VT', 'Burlington', 5401, 5408],
  ['VA', 'Virginia Beach', 23451, 23464], ['VA', 'Norfolk', 23502, 23523], ['VA', 'Chesapeake', 23320, 23325], ['VA', 'Arlington', 22201, 22209], ['VA', 'Alexandria', 22301, 22314],
  ['VA', 'Newport News', 23601, 23608], ['VA', 'Fairfax', 22030, 22033, /\bFairfax County\b/i], ['VA', 'Roanoke', 24011, 24019],
  ['WA', 'Seattle', 98101, 98199, /\bKing County\b/i], ['WA', 'Spokane', 99201, 99224], ['WA', 'Tacoma', 98402, 98422, /\bPierce County\b/i], ['WA', 'Vancouver', 98660, 98686], ['WA', 'Bellevue', 98004, 98008],
  ['WA', 'Everett', 98201, 98208], ['WA', 'Bothell', 98011, 98012], ['WA', 'Shoreline', 98133, 98155], ['WA', 'Burien', 98146, 98168],
  ['WV', 'Huntington', 25701, 25705], ['WV', 'Morgantown', 26501, 26508],
  ['WI', 'Milwaukee', 53202, 53233], ['WI', 'Green Bay', 54301, 54313], ['WI', 'Kenosha', 53140, 53144],
  ['IN', 'Indianapolis', 46201, 46260, /\bCitizens (?:Energy|Water)\b/i], ['CO', 'Denver', 80202, 80239], ['TX', 'Austin', 78701, 78759, /\bTravis\b|\bCentral Texas\b/i],
  ['AZ', 'Phoenix', 85003, 85054], ['GA', 'Atlanta', 30303, 30342], ['TN', 'Nashville', 37203, 37221, /\bDavidson County\b/i], ['OH', 'Columbus', 43201, 43235],
  ['NC', 'Raleigh', 27601, 27617, /\bWake County\b/i], ['MN', 'Saint Paul', 55101, 55119, /\bSt\.? Paul\b/i], ['HI', 'Honolulu', 96813, 96826, /\bOahu\b/i], ['UT', 'Salt Lake City', 84101, 84121],
  ['MA', 'Boston', 2108, 2136], ['OK', 'Oklahoma City', 73102, 73132], ['WI', 'Madison', 53703, 53726], ['NE', 'Lincoln', 68502, 68528], ['LA', 'Baton Rouge', 70801, 70820],
  ['KY', 'Frankfort', 40601, 40601], ['MS', 'Jackson', 39201, 39216], ['AR', 'Little Rock', 72201, 72227], ['AR', 'Fayetteville', 72701, 72704], ['ID', 'Boise', 83702, 83716],
  ['AK', 'Anchorage', 99501, 99518], ['DE', 'Wilmington', 19801, 19810], ['NH', 'Manchester', 3101, 3104], ['ME', 'Portland', 4101, 4103], ['PR', 'San Juan', 901, 926],
  // County-level billers (treasurers, tax collectors, county utilities): the county seat or its largest city, so a
  // county's customer does not live in the state capital (Orange County CA is not Sacramento).
  ['CA', 'Santa Ana', 92701, 92707, /\bOrange County\b/i], ['CA', 'San Jose', 95110, 95136, /\bSanta Clara County\b/i], ['CA', 'Martinez', 94553, 94553, /\bContra Costa\b/i],
  ['CA', 'Redwood City', 94061, 94063, /\bSan Mateo County\b/i], ['CA', 'Ventura', 93001, 93004, /\bVentura County\b/i], ['CA', 'Bakersfield', 93301, 93314, /\bKern County\b/i],
  ['CA', 'Stockton', 95202, 95212, /\bSan Joaquin County\b/i], ['CA', 'Santa Rosa', 95401, 95409, /\bSonoma County\b/i], ['CA', 'Modesto', 95350, 95358, /\bStanislaus\b/i],
  ['AZ', 'Tucson', 85701, 85750, /\bPima County\b/i],
  ['TX', 'McKinney', 75069, 75072, /\bCollin County\b/i], ['TX', 'Denton', 76201, 76210], ['TX', 'Edinburg', 78539, 78542, /\bHidalgo County\b/i], ['TX', 'Richmond', 77469, 77469, /\bFort Bend\b/i],
  ['TX', 'Georgetown', 78626, 78628, /\bWilliamson County\b/i], ['TX', 'Conroe', 77301, 77306, /\bMontgomery County\b/i],
  ['FL', 'Fort Myers', 33901, 33913, /\bLee County\b/i], ['FL', 'Bartow', 33830, 33830, /\bPolk County\b/i], ['FL', 'Melbourne', 32901, 32904, /\bBrevard\b/i], ['FL', 'Daytona Beach', 32114, 32119, /\bVolusia\b/i],
  ['FL', 'Sanford', 32771, 32773, /\bSeminole County\b/i], ['FL', 'Dade City', 33523, 33525, /\bPasco County\b/i], ['FL', 'Sarasota', 34230, 34243, /\bSarasota County\b/i],
  ['NY', 'Brooklyn', 11201, 11238, /\bKings County\b/i], ['NY', 'Jamaica', 11432, 11436, /\bQueens County\b/i], ['NY', 'Bronx', 10451, 10475], ['NY', 'Staten Island', 10301, 10314, /\bRichmond County\b/i],
  ['NY', 'White Plains', 10601, 10607, /\bWestchester\b/i],
  ['IL', 'Wheaton', 60187, 60189, /\bDuPage\b/i], ['IL', 'Waukegan', 60085, 60087, /\bLake County\b/i], ['IL', 'Joliet', 60431, 60436, /\bWill County\b/i], ['IL', 'Geneva', 60134, 60134, /\bKane County\b/i],
  ['WA', 'Everett', 98201, 98208, /\bSnohomish\b/i], ['WA', 'Vancouver', 98660, 98686, /\bClark County\b/i],
  ['GA', 'Lawrenceville', 30043, 30046, /\bGwinnett\b/i], ['GA', 'Marietta', 30060, 30068, /\bCobb County\b/i], ['GA', 'Decatur', 30030, 30035, /\bDeKalb\b/i],
  ['NC', 'Greensboro', 27401, 27410, /\bGuilford\b/i], ['NC', 'Winston-Salem', 27101, 27127, /\bForsyth County\b/i],
  ['OH', 'Cleveland', 44102, 44135, /\bCuyahoga\b/i], ['OH', 'Cincinnati', 45202, 45249, /\bHamilton County\b/i], ['OH', 'Akron', 44301, 44320, /\bSummit County\b/i],
  ['OH', 'Dayton', 45402, 45420, /\bMontgomery County\b/i], ['OH', 'Toledo', 43604, 43623, /\bLucas County\b/i],
  ['MI', 'Detroit', 48201, 48235, /\bWayne County\b/i], ['MI', 'Pontiac', 48340, 48342, /\bOakland County\b/i], ['MI', 'Mount Clemens', 48043, 48043, /\bMacomb\b/i], ['MI', 'Grand Rapids', 49503, 49548, /\bKent County\b/i],
  ['MI', 'Ann Arbor', 48103, 48109, /\bWashtenaw\b/i],
  ['PA', 'Norristown', 19401, 19403, /\bMontgomery County\b/i], ['PA', 'Doylestown', 18901, 18902, /\bBucks County\b/i], ['PA', 'West Chester', 19380, 19382, /\bChester County\b/i],
  ['NJ', 'Hackensack', 7601, 7602, /\bBergen\b/i], ['NJ', 'Newark', 7102, 7114, /\bEssex County\b/i], ['NJ', 'Jersey City', 7302, 7307, /\bHudson County\b/i], ['NJ', 'New Brunswick', 8901, 8906, /\bMiddlesex County\b/i],
  ['NJ', 'Freehold', 7728, 7728, /\bMonmouth\b/i], ['NJ', 'Toms River', 8753, 8757, /\bOcean County\b/i],
  ['MN', 'Minneapolis', 55401, 55419, /\bHennepin\b/i], ['MN', 'Saint Paul', 55101, 55119, /\bRamsey County\b/i], ['WI', 'Madison', 53703, 53726, /\bDane County\b/i],
  ['MO', 'Kansas City', 64105, 64138, /\bJackson County\b/i], ['TN', 'Knoxville', 37902, 37938, /\bKnox County\b/i], ['TN', 'Chattanooga', 37402, 37421, /\bHamilton County\b/i],
  ['IN', 'Indianapolis', 46201, 46260, /\bMarion County\b/i], ['IN', 'Crown Point', 46307, 46307, /\bLake County\b/i],
  ['MD', 'Upper Marlboro', 20772, 20774, /\bPrince George'?s\b/i], ['VA', 'Manassas', 20109, 20112, /\bPrince William\b/i], ['VA', 'Leesburg', 20175, 20176, /\bLoudoun\b/i],
  ['UT', 'Provo', 84601, 84606, /\bUtah County\b/i], ['NV', 'Reno', 89501, 89523, /\bWashoe\b/i], ['CO', 'Colorado Springs', 80903, 80920, /\bEl Paso County\b/i], ['CO', 'Littleton', 80120, 80128, /\bArapahoe\b/i],
  ['KY', 'Louisville', 40202, 40245, /\bJefferson County\b/i], ['KY', 'Lexington', 40502, 40517, /\bFayette County\b/i],
  ['LA', 'New Orleans', 70112, 70131, /\bOrleans Parish\b/i], ['LA', 'Gretna', 70053, 70056, /\bJefferson Parish\b/i],
  ['OR', 'Portland', 97201, 97236, /\bMultnomah\b/i], ['OR', 'Hillsboro', 97123, 97124, /\bWashington County\b/i], ['OR', 'Eugene', 97401, 97405, /\bLane County\b/i],
  ['AL', 'Birmingham', 35203, 35235, /\bJefferson County\b/i], ['AL', 'Huntsville', 35801, 35816, /\bMadison County\b/i],
  ['HI', 'Hilo', 96720, 96720, /\bHawaii County\b|\bCounty of Hawai.?i\b/i], ['HI', 'Wailuku', 96793, 96793, /\bMaui\b/i],
  ['AK', 'Fairbanks', 99701, 99709, /\bFairbanks North Star\b/i], ['AK', 'Soldotna', 99669, 99669, /\bKenai Peninsula\b/i], ['AK', 'Palmer', 99645, 99645, /\bMatanuska-Susitna\b/i],
  ['AK', 'Ketchikan', 99901, 99901], ['AK', 'Kodiak', 99615, 99615]
].map(([state, city, lo, hi, extra]) => ({ state, city, lo, hi, re: new RegExp(`\\b${city.replace(/[.]/g, '\\.?').replace(/ /g, '\\s+')}\\b${extra ? `|${extra.source}` : ''}`, extra?.flags || '') }));

const zip5 = n => String(n).padStart(5, '0');

// First city of `state` named in any of `texts` (earliest text wins, then earliest position inside it).
export function cityIn(state, texts) {
  for (const text of texts) {
    const s = String(text || ''); if (!s) continue;
    let best = null;
    for (const c of CITIES) {
      if (c.state !== state) continue;
      const m = c.re.exec(s);
      if (m && (!best || m.index < best.index)) best = { c, index: m.index };
    }
    if (best) return best.c;
  }
  return null;
}

// { city, zip } for a place: the named city's own ZIPs, else the state capital's.
export function placeIn(state, texts, r) {
  const c = cityIn(state, texts) || (CAPITALS[state] ? { city: CAPITALS[state][0], lo: CAPITALS[state][1], hi: CAPITALS[state][2] } : null);
  if (!c) return null;
  return { city: c.city, zip: zip5(c.lo + Math.floor(r() * (c.hi - c.lo + 1))) };
}
