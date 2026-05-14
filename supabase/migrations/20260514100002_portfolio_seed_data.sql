-- ============================================================================
-- PORTFOLIO SEED DATA — from BW-UQDRE-MP-2026-001-v5.3A & West Wendover MP
-- ============================================================================

-- ─── Brands ─────────────────────────────────────────────────────────────────

INSERT INTO brands (id, code, name, description) VALUES
  ('a0000001-0000-4000-b000-000000000001', 'UQDRE', 'Utah Quantum Defense Rail & Energy Corridor', 'Utah inland core program'),
  ('a0000001-0000-4000-b000-000000000002', 'AERC', 'American Energy Rail Corridor', 'Transcontinental rail and energy spine'),
  ('a0000001-0000-4000-b000-000000000003', 'ASTQR', 'American Sovereign Transcontinental Quantum Rail', 'Quantum-secure rail network'),
  ('a0000001-0000-4000-b000-000000000004', 'MQDC', 'Maritime Quantum Defense Corridor', 'Pacific and coastal quantum nodes'),
  ('a0000001-0000-4000-b000-000000000005', 'ASEDG', 'American Sovereign Energy Defense Grid', 'Defense-grade distributed energy'),
  ('a0000001-0000-4000-b000-000000000006', 'USASEA', 'USA Sovereign Energy Alliance', 'Multi-state energy coalition')
ON CONFLICT (code) DO NOTHING;

-- ─── Corridors ──────────────────────────────────────────────────────────────

INSERT INTO corridors (id, brand_id, name, description, region) VALUES
  -- Salt Circuit (Branch 1) — under UQDRE
  ('a0000002-0000-4000-b000-000000000001', 'a0000001-0000-4000-b000-000000000001',
   'Salt Circuit', 'SLC to Grantsville to Tooele to West Wendover — AERC spine + STRACNET freight', 'Utah western corridor'),

  -- Canyon Circuit branches — under UQDRE
  ('a0000002-0000-4000-b000-000000000002', 'a0000001-0000-4000-b000-000000000001',
   'Canyon Circuit — Branch 1', 'Tremonton / Box Elder / Brigham City — Hill AFB corridor', 'Wasatch Front north'),
  ('a0000002-0000-4000-b000-000000000003', 'a0000001-0000-4000-b000-000000000001',
   'Canyon Circuit — Mountain (Branch 2)', 'SLC Airport to Park City to Deer Valley to Utah Olympic Park', 'Wasatch mountains'),
  ('a0000002-0000-4000-b000-000000000004', 'a0000001-0000-4000-b000-000000000001',
   'Canyon Circuit — East (Branch 3)', 'Central SLC to U of U to Parleys to Morgan to Ogden to Logan to Idaho Falls', 'Wasatch Front east'),
  ('a0000002-0000-4000-b000-000000000005', 'a0000001-0000-4000-b000-000000000001',
   'Canyon Circuit — Canyons (Branch 4)', 'SLC Airport to I-215 to Little Cottonwood to Big Cottonwood — 2034 Olympics', 'Cottonwood canyons'),
  ('a0000002-0000-4000-b000-000000000006', 'a0000001-0000-4000-b000-000000000001',
   'Canyon Circuit — Southern', 'Cedar City / Iron County — UTTR southern corridor', 'Southern Utah'),

  -- Carbon Circuit (Branch 6) — under UQDRE
  ('a0000002-0000-4000-b000-000000000007', 'a0000001-0000-4000-b000-000000000001',
   'Carbon Circuit', 'Price to Myton to Roosevelt to Vernal to Dinosaur — freight + energy corridor', 'Uinta Basin'),

  -- Silver Corridor — under AERC
  ('a0000002-0000-4000-b000-000000000008', 'a0000001-0000-4000-b000-000000000002',
   'Silver Corridor', 'I-80 / Union Pacific Nevada spine — West Wendover to Elko to Battle Mountain', 'Nevada I-80'),

  -- Ditat Deus Sovereign Line — under AERC
  ('a0000002-0000-4000-b000-000000000009', 'a0000001-0000-4000-b000-000000000002',
   'Ditat Deus Sovereign Line', 'Flagstaff and southern Arizona / New Mexico corridor', 'Arizona / New Mexico'),

  -- MQDC Maritime — under MQDC
  ('a0000002-0000-4000-b000-000000000010', 'a0000001-0000-4000-b000-000000000004',
   'MQDC Maritime', 'Pacific and coastal quantum node network', 'Pacific Coast'),

  -- Northern Link — under AERC
  ('a0000002-0000-4000-b000-000000000011', 'a0000001-0000-4000-b000-000000000002',
   'Northern Link', 'Montana and Washington state defense nodes', 'Northern Rockies'),

  -- Colorado Arc — under AERC
  ('a0000002-0000-4000-b000-000000000012', 'a0000001-0000-4000-b000-000000000002',
   'Colorado Arc', 'Grand Junction / Montrose — Buckley SFB corridor', 'Colorado'),

  -- Wyoming Link — under AERC
  ('a0000002-0000-4000-b000-000000000013', 'a0000001-0000-4000-b000-000000000002',
   'Wyoming Link', 'Rock Springs — F.E. Warren AFB corridor', 'Wyoming')
ON CONFLICT DO NOTHING;

-- ─── Sites: Inland / Intermountain Portfolio (Section 7) ────────────────────

INSERT INTO sites (id, corridor_id, site_number, name, city, county, state, status, bw_role, military_nexus, military_installations, is_lead_site, anchor_partner, stracnet_status) VALUES
  -- Site 1: Tooele Army Depot
  ('a0000003-0000-4000-b000-000000000001', 'a0000002-0000-4000-b000-000000000001',
   1, 'Tooele Army Depot', 'Tooele', 'Tooele', 'UT', 'active', 'master_developer_gc',
   'Tooele Army Depot — direct', ARRAY['Tooele Army Depot'], false, NULL, 'STRACNET candidate'),

  -- Site 2: Stockton
  ('a0000003-0000-4000-b000-000000000002', 'a0000002-0000-4000-b000-000000000001',
   2, 'Stockton', 'Stockton', 'Tooele', 'UT', 'active', 'master_developer_gc',
   'Tooele Army Depot corridor', ARRAY['Tooele Army Depot'], false, NULL, NULL),

  -- Site 3: Grantsville
  ('a0000003-0000-4000-b000-000000000003', 'a0000002-0000-4000-b000-000000000001',
   3, 'Grantsville', 'Grantsville', 'Tooele', 'UT', 'active', 'master_developer_gc',
   'Tooele Army Depot corridor', ARRAY['Tooele Army Depot'], false, NULL, NULL),

  -- Site 4: Logan / USU Space Dynamics Lab
  ('a0000003-0000-4000-b000-000000000004', 'a0000002-0000-4000-b000-000000000004',
   4, 'Logan / USU Space Dynamics Lab', 'Logan', 'Cache', 'UT', 'active', NULL,
   'USU SDL — defense research', ARRAY['USU Space Dynamics Lab'], false, 'USU', NULL),

  -- Site 5: Tremonton (Box Elder Stratos Elk Quantum Campus — LEAD SITE)
  ('a0000003-0000-4000-b000-000000000005', 'a0000002-0000-4000-b000-000000000002',
   5, 'Tremonton (Box Elder Stratos Elk Quantum Campus)', 'Tremonton', 'Box Elder', 'UT', 'lead_site', 'master_developer_gc',
   'Hill AFB, Tooele Army Depot', ARRAY['Hill AFB', 'Tooele Army Depot'], true, 'MIDA',
   'STRACNET spur — Hill AFB (planning level)'),

  -- Site 6: Corinne
  ('a0000003-0000-4000-b000-000000000006', 'a0000002-0000-4000-b000-000000000002',
   6, 'Corinne', 'Corinne', 'Box Elder', 'UT', 'active', NULL,
   'Hill AFB corridor', ARRAY['Hill AFB'], false, NULL, NULL),

  -- Site 7: Price
  ('a0000003-0000-4000-b000-000000000007', 'a0000002-0000-4000-b000-000000000007',
   7, 'Price', 'Price', 'Carbon', 'UT', 'active', NULL,
   'National Guard corridor', ARRAY[]::text[], false, NULL, NULL),

  -- Site 8: Myton
  ('a0000003-0000-4000-b000-000000000008', 'a0000002-0000-4000-b000-000000000007',
   8, 'Myton', 'Myton', 'Duchesne', 'UT', 'active', NULL,
   'Uinta Basin corridor', ARRAY[]::text[], false, NULL, NULL),

  -- Site 9: Roosevelt
  ('a0000003-0000-4000-b000-000000000009', 'a0000002-0000-4000-b000-000000000007',
   9, 'Roosevelt', 'Roosevelt', 'Duchesne', 'UT', 'active', NULL,
   'Uinta Basin corridor', ARRAY[]::text[], false, NULL, NULL),

  -- Site 10: Vernal
  ('a0000003-0000-4000-b000-000000000010', 'a0000002-0000-4000-b000-000000000007',
   10, 'Vernal', 'Vernal', 'Uintah', 'UT', 'active', NULL,
   'Uinta Basin — energy hub', ARRAY[]::text[], false, NULL, NULL),

  -- Site 11: Dinosaur Underground Facility
  ('a0000003-0000-4000-b000-000000000011', 'a0000002-0000-4000-b000-000000000007',
   11, 'Dinosaur Underground Facility', 'Dinosaur', 'Uintah / Moffat', 'UT/CO', 'planning', NULL,
   'Subsurface geology — defense hardening', ARRAY[]::text[], false, NULL, NULL),

  -- Site 12: Cedar City / Iron County
  ('a0000003-0000-4000-b000-000000000012', 'a0000002-0000-4000-b000-000000000006',
   12, 'Cedar City / Iron County', 'Cedar City', 'Iron', 'UT', 'active', NULL,
   'UTTR southern corridor', ARRAY['UTTR'], false, NULL, NULL),

  -- Site 12B: Blanding
  ('a0000003-0000-4000-b000-0000000001ab', 'a0000002-0000-4000-b000-000000000006',
   120, 'Blanding', 'Blanding', 'San Juan', 'UT', 'planning', NULL,
   'Alternate / supplemental SE site', ARRAY[]::text[], false, NULL, NULL),

  -- Site 13: West Wendover
  ('a0000003-0000-4000-b000-000000000013', 'a0000002-0000-4000-b000-000000000008',
   13, 'West Wendover', 'West Wendover', 'Elko', 'NV', 'active', 'master_developer_gc',
   'Historic Wendover Airfield; UTTR border', ARRAY['Wendover Airfield', 'UTTR'], false, 'McCleery Company', NULL),

  -- Site 13-ELK: Elko
  ('a0000003-0000-4000-b000-00000000013e', 'a0000002-0000-4000-b000-000000000008',
   130, 'Elko', 'Elko', 'Elko', 'NV', 'active', NULL,
   'Elko County NV National Guard', ARRAY['NV National Guard'], false, NULL, NULL),

  -- Site 14: Battle Mountain
  ('a0000003-0000-4000-b000-000000000014', 'a0000002-0000-4000-b000-000000000008',
   14, 'Battle Mountain', 'Battle Mountain', 'Lander', 'NV', 'active', NULL,
   'Hawthorne Army Depot supply corridor', ARRAY['Hawthorne Army Depot'], false, NULL, NULL),

  -- Site 15: Idaho Falls / Twin Falls INL
  ('a0000003-0000-4000-b000-000000000015', 'a0000002-0000-4000-b000-000000000004',
   15, 'Idaho Falls / INL', 'Idaho Falls', 'Bonneville', 'ID', 'active', NULL,
   'Mountain Home AFB; INL federal', ARRAY['Mountain Home AFB', 'INL'], false, 'INL', NULL),

  -- Site 16: Grand Junction
  ('a0000003-0000-4000-b000-000000000016', 'a0000002-0000-4000-b000-000000000012',
   16, 'Grand Junction', 'Grand Junction', 'Mesa', 'CO', 'planning', NULL,
   'Buckley SFB corridor', ARRAY['Buckley SFB'], false, NULL, NULL),

  -- Site 17: Dinosaur Surface Component
  ('a0000003-0000-4000-b000-000000000017', 'a0000002-0000-4000-b000-000000000007',
   17, 'Dinosaur Surface Component', 'Dinosaur', 'Moffat', 'CO', 'planning', NULL,
   'Complement to Site 11', ARRAY[]::text[], false, NULL, NULL),

  -- Site 18: Albuquerque / Kirtland / Sandia
  ('a0000003-0000-4000-b000-000000000018', 'a0000002-0000-4000-b000-000000000009',
   18, 'Albuquerque / Kirtland / Sandia', 'Albuquerque', 'Bernalillo', 'NM', 'planning', NULL,
   'Kirtland AFB; Sandia NL', ARRAY['Kirtland AFB', 'Sandia National Lab'], false, NULL, NULL),

  -- Site 19: Rock Springs
  ('a0000003-0000-4000-b000-000000000019', 'a0000002-0000-4000-b000-000000000013',
   19, 'Rock Springs', 'Rock Springs', 'Sweetwater', 'WY', 'planning', NULL,
   'F.E. Warren AFB corridor', ARRAY['F.E. Warren AFB'], false, NULL, NULL),

  -- Site 20: Montrose
  ('a0000003-0000-4000-b000-000000000020', 'a0000002-0000-4000-b000-000000000012',
   20, 'Montrose', 'Montrose', 'Montrose', 'CO', 'planning', NULL,
   'Fort Carson corridor', ARRAY['Fort Carson'], false, NULL, NULL),

  -- Site 21: Great Falls / Malmstrom AFB
  ('a0000003-0000-4000-b000-000000000021', 'a0000002-0000-4000-b000-000000000011',
   21, 'Great Falls / Malmstrom AFB', 'Great Falls', 'Cascade', 'MT', 'planning', NULL,
   'Malmstrom AFB — ICBM field', ARRAY['Malmstrom AFB'], false, NULL, NULL),

  -- Site 22: Spokane / Fairchild AFB
  ('a0000003-0000-4000-b000-000000000022', 'a0000002-0000-4000-b000-000000000011',
   22, 'Spokane / Fairchild AFB', 'Spokane', 'Spokane', 'WA', 'planning', NULL,
   'Fairchild AFB', ARRAY['Fairchild AFB'], false, NULL, NULL),

  -- Site 26: Flagstaff / Northern Arizona Tech Park
  ('a0000003-0000-4000-b000-000000000026', 'a0000002-0000-4000-b000-000000000009',
   26, 'Flagstaff / Northern Arizona Tech Park', 'Flagstaff', 'Coconino', 'AZ', 'active', NULL,
   'Fort Huachuca; Davis-Monthan AFB; Luke AFB corridor', ARRAY['Fort Huachuca', 'Davis-Monthan AFB', 'Luke AFB'], false, NULL, NULL)
ON CONFLICT (site_number) DO NOTHING;

-- ─── Sites: Maritime / Coastal Portfolio (MQDC) ─────────────────────────────

INSERT INTO sites (id, corridor_id, site_number, name, city, county, state, status, military_nexus, military_installations) VALUES
  ('a0000003-0000-4000-b000-000000000023', 'a0000002-0000-4000-b000-000000000010',
   23, 'Mare Island', 'Vallejo', 'Solano', 'CA', 'planning',
   'Former naval shipyard; deep-water port', ARRAY['Mare Island Naval Shipyard']),
  ('a0000003-0000-4000-b000-000000000024', 'a0000002-0000-4000-b000-000000000010',
   24, 'La Jolla / Scripps / UC San Diego', 'La Jolla', 'San Diego', 'CA', 'planning',
   'SPAWAR; Naval Base Point Loma', ARRAY['SPAWAR', 'Naval Base Point Loma']),
  ('a0000003-0000-4000-b000-000000000025', 'a0000002-0000-4000-b000-000000000010',
   25, 'Puget Sound / Bremerton', 'Bremerton', 'Kitsap', 'WA', 'planning',
   'Naval Base Kitsap; submarine nexus', ARRAY['Naval Base Kitsap']),
  ('a0000003-0000-4000-b000-0000000025ab', 'a0000002-0000-4000-b000-000000000010',
   251, 'Humboldt Bay', 'Eureka', 'Humboldt', 'CA', 'evaluation',
   'Subsea geology evaluation', ARRAY[]::text[]),
  ('a0000003-0000-4000-b000-0000000025ac', 'a0000002-0000-4000-b000-000000000010',
   252, 'Monterey Bay', 'Monterey', 'Monterey', 'CA', 'planning',
   'Naval Postgraduate School; MBARI', ARRAY['Naval Postgraduate School', 'MBARI']),
  ('a0000003-0000-4000-b000-0000000025ad', 'a0000002-0000-4000-b000-000000000010',
   253, 'Channel Islands / Point Mugu', 'Point Mugu', 'Ventura', 'CA', 'planning',
   'Naval Base Ventura County', ARRAY['Naval Base Ventura County']),
  ('a0000003-0000-4000-b000-0000000025ae', 'a0000002-0000-4000-b000-000000000010',
   254, 'Offshore Oregon / Washington', NULL, NULL, 'OR/WA', 'evaluation',
   'Subsea evaluation zone — Project Natick precedent', ARRAY[]::text[])
ON CONFLICT (site_number) DO NOTHING;

-- ─── Components: West Wendover (Site 13) from WW Master Plan ────────────────

INSERT INTO components (site_id, type, name, specs, capital_low, capital_mid, capital_high, contingency_pct, phase, status) VALUES
  -- Hospital Phase 1
  ('a0000003-0000-4000-b000-000000000013', 'hospital',
   'Intermountain Healthcare Academic Medical Center — Phase 1',
   '{"beds": 300, "sf": "700000-900000", "partner": "Intermountain Healthcare / University of Utah"}'::jsonb,
   400000000, 462500000, 525000000, 30.00, 'Phase 1', 'conceptual'),

  -- Light Rail Transit
  ('a0000003-0000-4000-b000-000000000013', 'light_rail',
   'Above-Ground Light Rail Transit System',
   '{"miles": 4.2, "stations": 6}'::jsonb,
   328000000, 328000000, 328000000, 30.00, 'Phase 1', 'conceptual'),

  -- Civic Center
  ('a0000003-0000-4000-b000-000000000013', 'civic_center',
   'Civic Center and Public Realm',
   '{"includes": "civic buildings, public plaza, landscaping"}'::jsonb,
   15000000, 20000000, 25000000, 30.00, 'Phase 1', 'conceptual'),

  -- Workforce Housing
  ('a0000003-0000-4000-b000-000000000013', 'workforce_housing',
   'Essential Workforce Housing Development',
   '{"units": 60}'::jsonb,
   27000000, 27000000, 27000000, 30.00, 'Phase 1', 'conceptual'),

  -- Quantum Data Center
  ('a0000003-0000-4000-b000-000000000013', 'quantum_data_center',
   'Quantum-Grade Data Center',
   '{"sf": 250000, "security": "DISA IL5 / FedRAMP High", "workloads": "defense and AI"}'::jsonb,
   715000000, 715000000, 715000000, 30.00, 'Phase 2', 'conceptual'),

  -- Power Nexus: Bloom Energy
  ('a0000003-0000-4000-b000-000000000013', 'power_nexus',
   'BWWWMP — Bloom Energy Fuel Cells',
   '{"mw": 100, "technology": "Bloom Energy SOFC", "deployment": "50 MW in 90 days, 100 MW in 120 days"}'::jsonb,
   195000000, 195000000, 195000000, 30.00, 'Phase 2', 'conceptual'),

  -- Power Nexus: Hydrogen + Solar
  ('a0000003-0000-4000-b000-000000000013', 'power_nexus',
   'BWWWMP — Hydrogen and Solar Backup',
   '{"includes": "green hydrogen production, solar array"}'::jsonb,
   98000000, 98000000, 98000000, 30.00, 'Phase 2', 'conceptual'),

  -- Power Nexus: NuScale SMR Planning
  ('a0000003-0000-4000-b000-000000000013', 'power_nexus',
   'BWWWMP — NuScale SMR Planning Capital',
   '{"mw": 308, "technology": "NuScale SMR", "note": "Full $2.5-4.0B financed separately via DOE LPO"}'::jsonb,
   98000000, 98000000, 98000000, 30.00, 'Phase 2', 'conceptual'),

  -- Public Safety Complex
  ('a0000003-0000-4000-b000-000000000013', 'public_safety_complex',
   'Public Safety Complex',
   '{"includes": "police HQ, training facilities, emergency operations center"}'::jsonb,
   45000000, 55000000, 65000000, 30.00, 'Phase 2', 'conceptual'),

  -- Urban Forestry
  ('a0000003-0000-4000-b000-000000000013', 'urban_forestry',
   'Urban Forestry and Green Infrastructure Program',
   '{"duration": "10 years", "includes": "citywide tree planting, parks, trails, stormwater"}'::jsonb,
   12000000, 15000000, 18000000, 30.00, 'Phase 2', 'conceptual'),

  -- Hospital Phase 2
  ('a0000003-0000-4000-b000-000000000013', 'hospital',
   'Hospital Phase 2 Expansion to 450+ Beds',
   '{"beds": 450, "expansion": true}'::jsonb,
   225000000, 262500000, 300000000, 30.00, 'Phase 2', 'conceptual')
ON CONFLICT DO NOTHING;

-- ─── Components: Tremonton Flagship (Site 5) ────────────────────────────────

INSERT INTO components (site_id, type, name, specs, phase, status) VALUES
  ('a0000003-0000-4000-b000-000000000005', 'quantum_data_center',
   'Box Elder Stratos Elk Quantum Data Center',
   '{"power_target_gw": 1.1, "cooling": "Ester immersion + industrial wastewater reuse + purple piping + cooling towers", "compliance": "DISA IL5, FedRAMP High, CMMC Level 3"}'::jsonb,
   'Phase 1', 'planning'),
  ('a0000003-0000-4000-b000-000000000005', 'power_nexus',
   'Tremonton N+4 Power System',
   '{"architecture": "N+4", "phases": "Bloom SOFC → Hydrogen → SMR → Dory Power community battery"}'::jsonb,
   'Phase 1', 'conceptual'),
  ('a0000003-0000-4000-b000-000000000005', 'cooling_infrastructure',
   'Immersion Cooling and Wastewater Reuse',
   '{"primary": "Ester-based immersion cooling", "secondary": "Industrial wastewater reuse (purple piping)", "tertiary": "Cooling towers"}'::jsonb,
   'Phase 1', 'conceptual')
ON CONFLICT DO NOTHING;

-- ─── Rail Branches (Section 8) ──────────────────────────────────────────────

INSERT INTO rail_branches (corridor_id, designation, brand_name, route_description, rail_type, military_connections, status) VALUES
  -- Branch 1: Salt Circuit
  ('a0000002-0000-4000-b000-000000000001', 'Branch 1', 'Salt Circuit',
   'SLC → Grantsville → Tooele → West Wendover', 'stracnet_freight',
   'Tooele Army Depot; Wendover Airfield corridor', 'planning'),

  -- Branch 2: Canyon Circuit Mountain
  ('a0000002-0000-4000-b000-000000000003', 'Branch 2', 'Canyon Circuit — Mountain',
   'SLC Airport → Park City → Deer Valley → Utah Olympic Park', 'passenger',
   '2034 Winter Olympics compliance infrastructure', 'planning'),

  -- Branch 3: Canyon Circuit Park-Heber
  ('a0000002-0000-4000-b000-000000000003', 'Branch 3', 'Canyon Circuit — Park-Heber',
   'Park City → Heber → Midway → Sundance → BYU / Provo', 'passenger',
   'Academic pipeline; Provo workforce', 'planning'),

  -- Branch 4: Canyon Circuit Canyons
  ('a0000002-0000-4000-b000-000000000005', 'Branch 4', 'Canyon Circuit — Canyons',
   'SLC Airport → I-215 → Little Cottonwood → Big Cottonwood', 'passenger',
   '2034 Winter Olympics; canyon access', 'planning'),

  -- Branch 5: Canyon Circuit East
  ('a0000002-0000-4000-b000-000000000004', 'Branch 5', 'Canyon Circuit — East',
   'Central SLC → 2100 South → U of U → Parleys Canyon → Morgan → Ogden → Brigham City → Tremonton → Logan → Idaho Falls', 'passenger_freight',
   'Hill AFB; Tooele Army Depot spur; INL / Mountain Home AFB (north)', 'planning'),

  -- Branch 6: Carbon Circuit
  ('a0000002-0000-4000-b000-000000000007', 'Branch 6', 'Carbon Circuit',
   'Price → Myton → Roosevelt → Vernal → Dinosaur', 'freight',
   'Uinta Basin energy infrastructure; defense geology', 'planning'),

  -- Silver Tortoise Corridor
  ('a0000002-0000-4000-b000-000000000008', 'Silver Tortoise', 'Silver Tortoise Corridor',
   'West Wendover → Elko → Battle Mountain (via Union Pacific I-80 corridor)', 'stracnet_freight',
   'Hawthorne Army Depot via Thorne siding; NAS Fallon corridor; Wendover Airfield', 'planning'),

  -- Ditat Deus AZ-1
  ('a0000002-0000-4000-b000-000000000009', 'AZ-1', 'Ditat Deus Sovereign Line — AZ-1',
   'Flagstaff ↔ Albuquerque via I-40 corridor', 'stracnet_freight',
   'Fort Huachuca; Kirtland AFB; Sandia NL', 'planning'),

  -- Ditat Deus AZ-2
  ('a0000002-0000-4000-b000-000000000009', 'AZ-2', 'Ditat Deus Sovereign Line — AZ-2',
   'Flagstaff → Page, AZ → Utah border', 'passenger',
   'Canyon Circuit south connector', 'planning'),

  -- Ditat Deus AZ-3
  ('a0000002-0000-4000-b000-000000000009', 'AZ-3', 'Ditat Deus Sovereign Line — AZ-3',
   'Flagstaff → Phoenix metro', 'passenger',
   'Luke AFB corridor', 'planning')
ON CONFLICT DO NOTHING;

-- ─── Trade Secrets (Section 14: TS-001 through TS-022) ──────────────────────

INSERT INTO trade_secrets (code, title, description) VALUES
  ('TS-001', 'Program Architecture', 'The integrated multi-branch quantum data center network, site sequencing, and rail connectivity design'),
  ('TS-002', 'Site Selection Methodology', 'Proprietary criteria, scoring system, and military nexus mapping methodology'),
  ('TS-003', 'N+4 Power Architecture', 'Bloom → SMR phasing; SOFC permanent retention rule; Dory Power community subsidy model'),
  ('TS-004', 'Cooling System Design', 'Ester immersion + industrial wastewater reuse + purple piping + cooling tower integration'),
  ('TS-005', 'Canyon Circuit Network Design', 'Segment routing, military connection points, Olympic alignment strategy, phasing sequence'),
  ('TS-006', 'Silver Corridor Design', 'I-80 / Union Pacific Nevada corridor brand, Hawthorne STRACNET connector strategy, NAS Fallon node logic'),
  ('TS-007', 'Ditat Deus Sovereign Line Design', 'Flagstaff site selection rationale, Fort Huachuca / Kirtland nexus strategy, AZ-1/2/3 corridor architecture'),
  ('TS-008', 'Sole-Source Justification Framework', 'Legal and programmatic basis for originating developer position'),
  ('TS-009', 'IMPLAN Impact Modeling Approach', 'Specific IMPLAN model configuration and permanent-position methodology'),
  ('TS-010', 'Community Subsidy Program Structure', 'PPP structure, city revenue-sharing model, stacked incentive design for DPHP / MHPS'),
  ('TS-011', 'Sendai Compliance Integration', 'Four-priority alignment strategy linking federal funding streams to community benefit'),
  ('TS-012', 'Box Elder Stratos Elk Quantum Campus', 'All planning, design, and MIDA competitive positioning for flagship site'),
  ('TS-013', 'NHO / 8(a) Integration Strategy', 'Nonprofit-to-for-profit delivery structure'),
  ('TS-014', 'Albania International Operations Strategy', 'Ber Wilson International program architecture'),
  ('TS-015', 'Subsea and Deep Geology Cooling Pathway', 'Albuquerque corridor geological cooling concept; MQDC subsea node framework'),
  ('TS-016', 'FAST-41 Designation Strategy', 'Project designation pathway and agency coordination sequence'),
  ('TS-017', 'NSM-22 Compliance Architecture', 'Mapping of program elements to NSM-22 critical infrastructure requirements'),
  ('TS-018', 'SMR Licensing Pathway', 'NRC engagement strategy and Phase 3 licensing timeline'),
  ('TS-019', 'Program Version Control System', 'Document control numbering system and version governance protocol'),
  ('TS-020', 'Hawthorne / Thorne Siding Integration Strategy', 'STRACNET connector extension rationale and Silver Corridor defense anchor positioning'),
  ('TS-021', 'NAS Fallon Defense Node Strategy', 'Naval Air Station Fallon community benefit and workforce integration framework'),
  ('TS-022', 'Flagstaff Site Development Strategy', 'Northern Arizona Tech Park site development sequence; NAU / Arizona Quantum Initiative pipeline')
ON CONFLICT (code) DO NOTHING;

-- ─── Revenue Share Agreement: West Wendover (60/40) ─────────────────────────

INSERT INTO revenue_share_agreements (site_id, city_pct, bw_pct, revenue_base, cadence, governance_notes) VALUES
  ('a0000003-0000-4000-b000-000000000013', 60.00, 40.00,
   'Operating revenue from BWWWMP (Ber Wilson and West Wendover Municipal Power)',
   'Annual',
   'Public-private partnership; City Council approval required; Community Benefits Oversight Committee established')
ON CONFLICT (site_id) DO NOTHING;
