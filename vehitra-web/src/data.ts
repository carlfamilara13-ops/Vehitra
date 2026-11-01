export type VehicleType = 'Motorcycle' | 'Car' | 'Truck' | 'Van' | 'Bus' | 'Bicycle' | 'Other';
export type CatalogVehicle = { id: string; make: string; model: string; year: string; type: VehicleType; status: 'Published' | 'Draft' | 'Review'; version: string; rules: number; imageUrl?: string };
export type Rule = { id: string; component: string; vehicle: string; interval: string; source: string; status: 'Verified' | 'Unverified' | 'Draft' };
export type ModelRequest = { id: string; model: string; type: VehicleType; requests: number; date: string; status: 'Pending' | 'In review' | 'Resolved' };
export type AdminUser = { id: string; name: string; email: string; role: string; status: 'Active' | 'Invited' | 'Suspended'; lastActive: string };
export const initialVehicles: CatalogVehicle[] = [
 {id:'VH-001',make:'Yamaha',model:'Sniper 155',year:'2024–2026',type:'Motorcycle',status:'Published',version:'v1.2',rules:12},
 {id:'VH-002',make:'Honda',model:'Click 125',year:'2023–2026',type:'Motorcycle',status:'Published',version:'v1.1',rules:11},
 {id:'VH-003',make:'Toyota',model:'Vios',year:'2022–2026',type:'Car',status:'Published',version:'v1.0',rules:14},
 {id:'VH-004',make:'Suzuki',model:'Raider R150',year:'2023–2026',type:'Motorcycle',status:'Review',version:'draft',rules:10},
 {id:'VH-005',make:'Generic',model:'Motorcycle',year:'All years',type:'Motorcycle',status:'Published',version:'v1.0',rules:8},
 {id:'VH-006',make:'Honda',model:'TMX 125',year:'2020–2026',type:'Motorcycle',status:'Draft',version:'draft',rules:9},
 {id:'VH-007',make:'Toyota',model:'Wigo',year:'2023–2026',type:'Car',status:'Published',version:'v1.0',rules:12},
 {id:'VH-008',make:'Generic',model:'Bicycle',year:'All years',type:'Bicycle',status:'Published',version:'v1.0',rules:5},
];
export const initialRules: Rule[] = [
 {id:'MR-101',component:'Engine oil',vehicle:'Yamaha Sniper 155',interval:'Every 3,000 km / 4 months',source:'Owner manual · page 6-3',status:'Verified'},
 {id:'MR-102',component:'Oil filter / strainer',vehicle:'Yamaha Sniper 155',interval:'Inspect every service',source:'Owner manual · page 6-4',status:'Verified'},
 {id:'MR-103',component:'Brake pads',vehicle:'Honda Click 125',interval:'Inspect every 4,000 km',source:'Needs source confirmation',status:'Unverified'},
 {id:'MR-104',component:'Drive chain',vehicle:'Suzuki Raider R150',interval:'Inspect / lubricate regularly',source:'Draft recommendation',status:'Draft'},
 {id:'MR-105',component:'Coolant',vehicle:'Toyota Vios',interval:'Check per manufacturer schedule',source:'Source pending',status:'Unverified'},
 {id:'MR-106',component:'Tire condition',vehicle:'Generic Motorcycle',interval:'Inspect before each ride',source:'General safety guidance',status:'Verified'},
];
export const initialRequests: ModelRequest[] = [
 {id:'REQ-204',model:'Honda ADV 160 (2025)',type:'Motorcycle',requests:18,date:'Oct 22, 2026',status:'Pending'},
 {id:'REQ-203',model:'Kawasaki Ninja 400',type:'Motorcycle',requests:12,date:'Oct 21, 2026',status:'In review'},
 {id:'REQ-202',model:'Isuzu Traviz',type:'Truck',requests:8,date:'Oct 19, 2026',status:'Pending'},
 {id:'REQ-201',model:'Toyota HiAce',type:'Van',requests:5,date:'Oct 18, 2026',status:'Resolved'},
];
export const initialUsers: AdminUser[] = [
 {id:'USR-001',name:'Alex Morgan',email:'alex@vehitra.app',role:'Super Admin',status:'Active',lastActive:'Now'},
 {id:'USR-002',name:'Jamie Santos',email:'jamie@vehitra.app',role:'Catalog Admin',status:'Active',lastActive:'12 min ago'},
 {id:'USR-003',name:'Taylor Reyes',email:'taylor@vehitra.app',role:'Support Admin',status:'Invited',lastActive:'Never'},
 {id:'USR-004',name:'Jordan Lee',email:'jordan@vehitra.app',role:'Catalog Admin',status:'Suspended',lastActive:'Oct 19, 2026'},
];
export const auditEvents = [
 {actor:'Jamie Santos',action:'Updated maintenance rule',target:'Yamaha Sniper 155 · Engine oil',time:'Today, 10:42 AM',kind:'Updated'},
 {actor:'Alex Morgan',action:'Published catalog version',target:'Catalog v1.2',time:'Today, 9:18 AM',kind:'Published'},
 {actor:'Jamie Santos',action:'Reviewed vehicle model',target:'Suzuki Raider R150',time:'Yesterday, 4:26 PM',kind:'Reviewed'},
 {actor:'System',action:'Catalog sync health check',target:'All regions',time:'Yesterday, 12:00 PM',kind:'System'},
 {actor:'Alex Morgan',action:'Invited administrator',target:'taylor@vehitra.app',time:'Oct 21, 2026, 2:17 PM',kind:'Access'},
];
