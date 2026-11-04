import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, listRides, type RideRow } from '../../data/local/ridesStore';
import { getActiveVehicle, type VehicleRow } from '../../data/local/vehicleStore';
import {
  listVehicleDocuments,
  type VehicleDocumentRow,
} from '../../data/local/vehicleDocumentStore';
import {
  deleteVehicleDocumentImage,
  persistVehicleDocumentImage,
} from '../../data/local/vehicleDocumentImages';
import { replaceVehicleDocumentImage } from '../../data/local/vehicleDocumentService';
import type { VehicleDocumentKind } from '../../domain/vehicleDocuments/documents';
import { getBatteryState, type BatteryStateRow } from '../../data/local/batteryStore';
import { listAllDeadlines, type DeadlineRow } from '../../data/local/deadlineStore';
import { getDriverProfile, type DriverProfileRow } from '../../data/local/driverProfileStore';
import { evaluateVehicleMaintenance, type VehicleMaintenance } from '../../data/local/maintenanceQuery';
import { daysUntilDateOnly, deadlinePhase, pickNextReminder } from '../../domain/reminders/dates';
import { batteryIdleDays, batteryIdleLevel, type BatteryIdleLevel } from '../../domain/battery/idle';
import type { ActivityRide } from '../../domain/dashboard/activity';
import { buildWalletDocs } from '../../domain/dashboard/wallet';
import { maintenanceLine } from '../record/garageView';
import Screen from '../../ui/Screen';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import DashboardHeader from './DashboardHeader';
import ActiveRideCard from './ActiveRideCard';
import WeeklyActivityCard from './WeeklyActivityCard';
import DocumentWalletCard from './DocumentWalletCard';
import DriverProfileEditModal from './DriverProfileEditModal';
import VehicleDocumentViewer, { type VehicleDocumentViewerTarget } from './VehicleDocumentViewer';
import {
  EMPTY_VEHICLE_DOCUMENTS,
  selectVehicleDocuments,
  withSavedVehicleDocument,
  type VehicleDocumentsState,
} from './vehicleDocumentsView';
import LongestRidesCard from './LongestRidesCard';
import VehicleStatusStrip, { batteryTone, maintenanceTone, type StatusStripItem } from './VehicleStatusStrip';

type Props = BottomTabScreenProps<RootTabParamList, 'Dashboard'>;

// Totals are derived from the existing listRides API. Local data only; the cap is a
// guardrail, not a schema change.
const RIDE_LIST_LIMIT = 1000;

// Dashboard. Reads only local stores: rides, active vehicle battery check-in, enabled
// reminders and the maintenance evaluation for the active vehicle. Everything shown exists  
// nothing is faked, and a piece with no data says so instead of hiding.
//
// The screen is composed from the section components that ship with it (header, live ride,
// weekly activity, document wallet, longest rides, vehicle status); each one owns its own
// empty state, so a section with no data reports that rather than disappearing.

// ---------------------------------------------------------------- helpers

function vehicleName(vehicle: VehicleRow | null): string | null {
  if (!vehicle) return null;
  return vehicle.nickname ?? vehicle.model ?? vehicle.brand ?? null;
}

// The battery cell states the idle level in words: the app cannot measure battery condition,
// only how long the user has gone without confirming the bike was in use.
function batteryDetail(level: BatteryIdleLevel, idleDays: number | null): string {
  if (level === 'warn') return 'Idle over a week';
  if (level === 'watch') return idleDays == null ? 'Idle   worth a check' : `Idle ${idleDays} days`;
  return idleDays == null ? 'In use recently' : `Used ${idleDays === 0 ? 'today' : `${idleDays} days ago`}`;
}

// The maintenance cell reports the worst outstanding condition, and never folds "unknown" into
// "good": the rules refuse to call an unmeasurable check healthy, so the strip keeps that
// distinction visible.
function maintenanceDetail(maintenance: VehicleMaintenance | null, failed: boolean): string {
  if (failed) return 'Could not check';
  if (!maintenance) return 'No vehicle';
  return maintenanceLine(maintenance.items) ?? 'No plan yet';
}

function maintenanceToneFor(maintenance: VehicleMaintenance | null, failed: boolean): StatusStripItem['tone'] {
  if (failed || !maintenance) return 'unknown';
  const items = maintenance.items;
  if (items.length === 0) return 'unknown';
  const tones = items.map((i) => maintenanceTone(i.evaluation.status));
  if (tones.includes('bad')) return 'bad';
  if (tones.includes('watch')) return 'watch';
  if (tones.includes('unknown')) return 'unknown';
  return 'ok';
}

// ---------------------------------------------------------------- screen

export default function DashboardScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const units = prefs.units;
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<RideRow | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [battery, setBattery] = useState<BatteryStateRow | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [profile, setProfile] = useState<DriverProfileRow | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [maintenance, setMaintenance] = useState<VehicleMaintenance | null>(null);
  const [maintFailed, setMaintFailed] = useState(false);
  const [documents, setDocuments] = useState<VehicleDocumentsState>(EMPTY_VEHICLE_DOCUMENTS);
  const [documentBusyKind, setDocumentBusyKind] = useState<VehicleDocumentKind | null>(null);
  const [documentError, setDocumentError] = useState<string | null>(null);
  const [viewerDocument, setViewerDocument] = useState<VehicleDocumentViewerTarget | null>(null);
  const pickingDocument = useRef(false);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const activeId = await getActiveRideId(db);
      const activeRide = activeId ? await getRide(db, activeId) : null;
      const all = await listRides(db, RIDE_LIST_LIMIT);
      setActive(activeRide);
      setRides(all);
    } catch {
      // The dashboard stays usable without the ride list: the sections that need it report
      // their own empty state instead of the whole screen failing.
      setActive(null);
      setRides([]);
    }
    try {
      const db = await getDb();
      const activeVehicle = await getActiveVehicle(db);
      // The profile is independent of the vehicle/reminders read: a failure here leaves the
      // card in its empty state without hiding the rest of the wallet.
      let driverProfile: DriverProfileRow | null = null;
      let profileError = false;
      try {
        driverProfile = await getDriverProfile(db);
      } catch {
        profileError = true;
      }
      // OR/CR reads are independent too: a failure leaves the two photo cards empty and lets the
      // wallet report the problem without hiding the rest of the dashboard.
      let documentRows: VehicleDocumentRow[] = [];
      let documentsError = false;
      if (activeVehicle) {
        try {
          documentRows = await listVehicleDocuments(db, activeVehicle.id);
        } catch {
          documentsError = true;
        }
      }
      const [batteryRow, deadlineRows] = await Promise.all([
        activeVehicle ? getBatteryState(db, activeVehicle.id) : Promise.resolve(null),
        listAllDeadlines(db),
      ]);
      // Maintenance evaluation is a derived read; if it fails the rest of the dashboard still
      // loads and the card reports the failure instead of pretending nothing is planned.
      let maint: VehicleMaintenance | null = null;
      let maintError = false;
      if (activeVehicle) {
        try {
          maint = await evaluateVehicleMaintenance(db, activeVehicle.id);
        } catch {
          maintError = true;
        }
      }
      setVehicle(activeVehicle);
      setBattery(batteryRow);
      setDeadlines(deadlineRows);
      setProfile(driverProfile);
      setProfileFailed(profileError);
      setMaintenance(maint);
      setMaintFailed(maintError);
      setDocuments({
        vehicleId: activeVehicle?.id ?? null,
        rows: documentRows,
        failed: documentsError,
        loaded: true,
      });
    } catch {
      setVehicle(null);
      setBattery(null);
      setDeadlines([]);
      setProfile(null);
      setProfileFailed(true);
      setMaintenance(null);
      setMaintFailed(true);
      setDocuments({ vehicleId: null, rows: [], failed: false, loaded: true });
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const chooseDocument = useCallback(
    async (kind: VehicleDocumentKind) => {
      if (pickingDocument.current) return;
      if (!vehicle) {
        setDocumentError('Add a vehicle before uploading an OR or CR photo.');
        return;
      }

      const vehicleId = vehicle.id;
      pickingDocument.current = true;
      setDocumentBusyKind(kind);
      setDocumentError(null);
      try {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          setDocumentError(
            'Allow photo access to choose a document photo. Your saved images are unchanged.',
          );
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
        });
        if (result.canceled) return;
        const asset = result.assets[0];
        if (!asset?.uri) {
          setDocumentError('That image could not be read. Choose another photo.');
          return;
        }
        if (asset.mimeType && !asset.mimeType.startsWith('image/')) {
          setDocumentError('That file is not a supported image. Choose a JPG, PNG, WEBP or HEIC photo.');
          return;
        }

        const db = await getDb();
        // A vehicle switch can happen while the system picker is open. Abort rather than saving
        // the document onto a vehicle that is no longer the active one.
        const activeNow = await getActiveVehicle(db);
        if (!activeNow || activeNow.id !== vehicleId) {
          setDocumentError(
            'The active vehicle changed. Choose the document photo again for the current vehicle.',
          );
          return;
        }

        const saved = await replaceVehicleDocumentImage(
          db,
          {
            persist: (sourceUri, fileName) =>
              persistVehicleDocumentImage(sourceUri, vehicleId, kind, fileName),
            remove: deleteVehicleDocumentImage,
          },
          {
            id: Crypto.randomUUID(),
            vehicleId,
            kind,
            sourceUri: asset.uri,
            fileName: asset.fileName,
          },
        );

        setDocuments((current) => withSavedVehicleDocument(current, vehicleId, saved));
      } catch {
        setDocumentError(
          'Could not save the document photo. Check available storage and try again. Any previous image was kept.',
        );
      } finally {
        pickingDocument.current = false;
        setDocumentBusyKind(null);
      }
    },
    [vehicle],
  );

  // Only trust rows tagged with the current vehicle. This is the guard that stops a previous
  // vehicle's OR/CR from showing during a switch or after a focus reload.
  const {
    rows: vehicleDocuments,
    loading: documentsLoading,
    unavailable: documentsUnavailable,
  } = selectVehicleDocuments(documents, vehicle?.id ?? null);

  // The weekly hero counts saved rides only; a ride still recording is not a record yet.
  const activityRides = useMemo<ActivityRide[]>(
    () =>
      rides.map((r) => ({
        startedAt: r.started_at,
        status: r.status,
        distanceM: r.distance_m,
        durationS: r.duration_s,
      })),
    [rides],
  );

  // Only finalized rides count towards the ranked longest rides.
  const savedRides = useMemo(() => rides.filter((r) => r.status !== 'recording'), [rides]);

  const docs = useMemo(
    () =>
      buildWalletDocs(
        deadlines,
        vehicle ? { name: vehicleName(vehicle), plate: vehicle.plate } : null,
        Date.now(),
      ),
    [deadlines, vehicle],
  );

  // Nearest reminder the user should still see. listAllDeadlines includes disabled and
  // soft-deleted rows on purpose (sync needs full state), so visibility is applied here.
  const nextDeadline = useMemo(() => pickNextReminder(deadlines), [deadlines]);
  const nextDays = nextDeadline ? daysUntilDateOnly(nextDeadline.due_date, Date.now()) : null;
  const nextPhase = deadlinePhase(nextDays);

  const statusItems = useMemo<StatusStripItem[]>(() => {
    const items: StatusStripItem[] = [];

    const idleDays = battery ? batteryIdleDays(battery.last_active_at, Date.now()) : null;
    const level = batteryIdleLevel(idleDays);
    items.push({
      key: 'battery',
      label: 'Battery',
      detail: batteryDetail(level, idleDays),
      tone: batteryTone(level),
      icon: 'battery-charging-outline',
    });

    items.push({
      key: 'maintenance',
      label: 'Maintenance',
      detail: maintenanceDetail(maintenance, maintFailed),
      tone: maintFailed ? 'unknown' : maintenanceToneFor(maintenance, maintFailed),
      icon: 'construct-outline',
    });

    items.push({
      key: 'reminder',
      label: 'Reminder',
      detail: nextDeadline
        ? nextPhase === 'overdue' && nextDays != null
          ? `${Math.abs(nextDays)}d overdue`
          : nextDays === 0
            ? 'Due today'
            : nextDays != null && nextDays < 30
              ? `In ${nextDays}d`
              : nextDeadline.due_date
        : 'None set',
      tone:
        nextPhase === 'overdue' ? 'bad' : nextPhase === 'due_soon' ? 'watch' : nextPhase === 'upcoming' ? 'ok' : 'unknown',
      icon: 'notifications-outline',
    });

    return items;
  }, [battery, maintenance, maintFailed, nextDeadline, nextDays, nextPhase]);

  return (
    <Screen contentStyle={{ paddingBottom: tabBarBottomClearance(insets.bottom) }}>
      <DashboardHeader onPressProfile={() => navigation.navigate('Account')} />
      {active ? (
        <ActiveRideCard
          ride={active}
          units={units}
          onOpenRecorder={() => navigation.navigate('Record')}
        />
      ) : null}
      <WeeklyActivityCard rides={activityRides} units={units} nowMs={Date.now()} />

      <VehicleStatusStrip
        vehicleName={vehicleName(vehicle)}
        items={statusItems}
        onOpenVehicle={() => navigation.navigate('Garage')}
      />

      <DocumentWalletCard
        docs={docs}
        profile={profile}
        profileUnavailable={profileFailed}
        hasVehicle={!!vehicle}
        vehicleName={vehicleName(vehicle)}
        documents={vehicleDocuments}
        documentsLoading={documentsLoading}
        documentsUnavailable={documentsUnavailable}
        documentBusyKind={documentBusyKind}
        documentError={documentError}
        onChooseDocument={(kind) => void chooseDocument(kind)}
        onOpenDocument={(kind, uri) => {
          setDocumentError(null);
          setViewerDocument({ kind, uri });
        }}
        onEditProfile={() => setProfileOpen(true)}
        onManage={() => setProfileOpen(true)}
      />

      <LongestRidesCard
        rides={savedRides}
        units={units}
        onOpenRide={(id) => navigation.navigate('RideDetail', { id })}
      />
      <DriverProfileEditModal
        visible={profileOpen}
        profile={profile}
        onCancel={() => setProfileOpen(false)}
        onSaved={(saved) => {
          setProfile(saved);
          setProfileFailed(false);
          setProfileOpen(false);
        }}
      />
      <VehicleDocumentViewer
        document={viewerDocument}
        onClose={() => setViewerDocument(null)}
      />
    </Screen>
  );
}
