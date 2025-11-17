import React, { useEffect, useState } from 'react';
import { 
  StyleSheet, Text, View, FlatList, ActivityIndicator, 
  SafeAreaView, StatusBar, TouchableOpacity 
} from 'react-native';

// --- DATEPICKER IMPORTS ---
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';

// --- CHART IMPORTS ---
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale,
  PointElement, LineElement, Title, Tooltip, Legend,
} from 'chart.js';
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  Title, Tooltip, Legend
);

// --- NAVIGATION IMPORTS ---
import { NavigationContainer } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { createStackNavigator } from '@react-navigation/stack';

// --- CSV IMPORT ---
import { CSVLink } from 'react-csv';

// --- NEW SOCKET.IO IMPORT ---
import { io } from 'socket.io-client';

// --- END IMPORTS ---

// Base URL of your Python server
const API_BASE_URL = 'http://127.0.0.1:5000';

// --- CSS INJECTION (This is required) ---
const injectCSS = () => {
  const style = document.createElement('style');
  style.textContent = `
    .react-datepicker__portal {
      background-color: rgba(0, 0, 0, 0.5); position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex; justify-content: center; align-items: center;
      z-index: 9998 !important;
    }
    .react-datepicker-popper { z-index: 9999 !important; }
    .react-datepicker-wrapper { display: contents; }
    .react-datepicker__input-container input {
      font-size: 16px; padding: 8px; border: 1px solid #ccc;
      border-radius: 4px; width: 120px; text-align: center;
    }
    .react-datepicker {
      font-family: Arial, sans-serif; background-color: white;
      border-radius: 8px; padding: 10px; border: 1px solid #ccc;
    }
    .react-datepicker__current-month {
      color: #000; font-size: 1.1rem; font-weight: bold;
      padding-bottom: 10px; text-align: center;
    }
    .react-datepicker__navigation { top: 15px; }
    .react-datepicker__day-name { color: #333; font-weight: bold; }
  `;
  document.head.appendChild(style);
};
injectCSS();

// --- HELPER FUNCTION to format date ---
const formatDate = (date) => date.toISOString().split('T')[0];

// ===================================================================
// --- 1. REUSABLE DASHBOARD COMPONENT (UPDATED) ---
// ===================================================================

function ReusableDashboard({ filter }) {
  const [isLoading, setIsLoading] = useState(true); // Set to true to load on open
  const [error, setError] = useState(null);
  const [feedbackList, setFeedbackList] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [trendData, setTrendData] = useState([]);
  
  const [startDate, setStartDate] = useState(new Date(new Date().setDate(new Date().getDate() - 30)));
  const [endDate, setEndDate] = useState(new Date());

  // --- UPDATED: Moved fetchData out of useEffect ---
  const fetchData = async () => {
    // Don't show loading spinner on background refresh
    // setIsLoading(true); 
    setError(null);

    const params = new URLSearchParams({
      start: formatDate(startDate),
      end: formatDate(endDate),
    });
    if (filter.store_id) params.append('store_id', filter.store_id);
    if (filter.area) params.append('area', filter.area);
    params.append('status', 'New');
    
    const queryString = params.toString();
    const feedbackURL = `${API_BASE_URL}/v1/feedback?${queryString}`;
    const metricsURL = `${API_BASE_URL}/v1/metrics?${queryString}`;
    const trendURL = `${API_BASE_URL}/v1/metrics/trend?${queryString}`;

    try {
      const [feedbackResponse, metricsResponse, trendResponse] = await Promise.all([
        fetch(feedbackURL), fetch(metricsURL), fetch(trendURL)
      ]);
      if (!feedbackResponse.ok || !metricsResponse.ok || !trendResponse.ok) {
        throw new Error(`HTTP error!`);
      }
      const feedbackJson = await feedbackResponse.json();
      const metricsJson = await metricsResponse.json();
      const trendJson = await trendResponse.json();
      
      setFeedbackList(feedbackJson);
      setMetrics(metricsJson);
      setTrendData(trendJson);
    } catch (e) {
      setError(e);
      console.error(e);
    } finally {
      setIsLoading(false); // Always stop loading
    }
  };

  // --- UPDATED: useEffect for loading and realtime ---
  useEffect(() => {
    // 1. Fetch data when the component loads
    setIsLoading(true); // Show loader on first load
    fetchData();

    // 2. Connect to the socket server
    const socket = io(API_BASE_URL);

    // 3. Listen for the 'new_feedback' event
    socket.on('new_feedback', (data) => {
      console.log('New feedback received! Refreshing dashboard...');
      fetchData(); // Re-run the fetch logic
    });
    
    // 4. Clean up the connection when the component unmounts
    return () => {
      socket.disconnect();
    };
  }, [filter]); // Re-run if the filter (e.g. store_id) changes

  const onChangeStartDate = (date) => setStartDate(date);
  const onChangeEndDate = (date) => setEndDate(date);

  // --- Reusable render components ---
  const renderItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <Text style={styles.itemText}>{item.text}</Text>
      <View style={styles.itemDetails}>
        <Text style={styles.itemCategory(item.category)}>{item.category}</Text>
        <Text style={styles.itemSentiment(item.sentiment)}>{item.sentiment}</Text>
      </View>
      <Text style={styles.itemTimestamp}>{new Date(item.timestamp).toLocaleString()}</Text>
    </View>
  );

  const MetricsSummary = () => {
    if (!metrics) return null; // Don't show if no data
    const { feedback_by_category, total_feedback } = metrics;
    const getAvg = (categoryName) => {
      const category = feedback_by_category[categoryName];
      if (category && category.average_sentiment_score) {
        const score = (category.average_sentiment_score + 1) * 2.5;
        return score.toFixed(1);
      }
      return 'N/A';
    };
    return (
      <View style={styles.metricsContainer}>
        <View style={styles.metricBox}><Text style={styles.metricValue}>{total_feedback}</Text><Text style={styles.metricLabel}>Total Feedback</Text></View>
        <View style={styles.metricBox}><Text style={styles.metricValue}>{getAvg('Quality of food')}</Text><Text style={styles.metricLabel}>Food Score</Text></View>
        <View style={styles.metricBox}><Text style={styles.metricValue}>{getAvg('Customer service')}</Text><Text style={styles.metricLabel}>Service Score</Text></View>
        <View style={styles.metricBox}><Text style={styles.metricValue}>{getAvg('Speed')}</Text><Text style={styles.metricLabel}>Speed Score</Text></View>
        <View style={styles.metricBox}><Text style={styles.metricValue}>{getAvg('Ambience')}</Text><Text style={styles.metricLabel}>Ambience Score</Text></View>
      </View>
    );
  };

  const SentimentTrendChart = () => {
    if (!trendData || trendData.length === 0) return null; 
    const chartData = {
      labels: trendData.map(item => item.date),
      datasets: [{
          label: 'Average Sentiment Score',
          data: trendData.map(item => item.average_sentiment),
          borderColor: 'rgb(0, 122, 255)',
          backgroundColor: 'rgba(0, 122, 255, 0.5)',
          fill: false, tension: 0.1
      }],
    };
    const chartOptions = {
      responsive: true,
      plugins: {
        legend: { position: 'top' },
        title: { display: true, text: 'Daily Sentiment Trend' },
      },
      scales: {
        y: {
          min: -1, max: 1,
          ticks: {
            callback: (value) => {
                if (value === 1) return 'Positive';
                if (value === 0) return 'Neutral';
                if (value === -1) return 'Negative';
                return null;
            }
          }
        }
      }
    };
    return <View style={styles.chartContainer}><Line options={chartOptions} data={chartData} /></View>;
  };

  const renderHeader = () => (
    <>
      <View style={styles.filterContainer}>
        <View style={styles.datePickerContainer}>
          <Text style={styles.dateLabel}>START DATE</Text>
          <DatePicker selected={startDate} onChange={onChangeStartDate} dateFormat="yyyy-MM-dd" withPortal />
        </View>
        <View style={styles.datePickerContainer}>
          <Text style={styles.dateLabel}>END DATE</Text>
          <DatePicker selected={endDate} onChange={onChangeEndDate} dateFormat="yyyy-MM-dd" withPortal />
        </View>
      </View>
      
      <View style={styles.buttonRow}>
        {/* Changed button text to "Refresh" */}
        <TouchableOpacity style={styles.applyButton} onPress={fetchData} disabled={isLoading}>
          <Text style={styles.applyButtonText}>{isLoading ? "LOADING..." : "REFRESH"}</Text>
        </TouchableOpacity>
        
        <CSVLink
          data={feedbackList}
          filename={`feedback-export-${formatDate(startDate)}-to-${formatDate(endDate)}.csv`}
          style={styles.exportButton(feedbackList.length === 0)}
          target="_blank"
        >
          Export to CSV
        </CSVLink>
      </View>
      
      <MetricsSummary />
      <SentimentTrendChart />
      <Text style={styles.listHeader}>Recent Feedback</Text>
    </>
  );

  return (
    <FlatList
      data={feedbackList}
      renderItem={renderItem}
      keyExtractor={item => item.id.toString()}
      ListHeaderComponent={renderHeader}
      ListEmptyComponent={() => (
        <View style={styles.center}>
          {isLoading && <ActivityIndicator size="large" />}
          {error && <><Text style={styles.errorText}>Failed to fetch data!</Text><Text>Is your Python server running?</Text></>}
          {!isLoading && !error && !feedbackList.length && <Text style={styles.noDataText}>No feedback found for this filter.</Text>}
        </View>
      )}
    />
  );
}

// ===================================================================
// --- 2. THE TAB SCREENS & NAVIGATION ---
// ===================================================================

// --- SCREEN 1: CORPORATE DASHBOARD ---
function CorporateDashboardScreen() {
  return <ReusableDashboard filter={{}} />;
}

// --- SCREEN 2: AREA LIST ---
function AreaListScreen({ navigation }) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [areaList, setAreaList] = useState([]);

  useEffect(() => {
    const fetchAreas = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/areas`);
        const json = await response.json();
        setAreaList(json);
      } catch (e) { setError(e); } 
      finally { setIsLoading(false); }
    };
    fetchAreas();
  }, []);

  const renderAreaItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.itemContainer}
      onPress={() => navigation.navigate('Store List', { area: item })}
    >
      <Text style={styles.itemText}>{item}</Text>
    </TouchableOpacity>
  );

  if (isLoading) return <View style={styles.center}><ActivityIndicator size="large" /><Text>Loading areas...</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.errorText}>Failed to fetch areas!</Text></View>;

  return (
    <FlatList
      data={areaList}
      renderItem={renderAreaItem}
      keyExtractor={item => item}
      ListHeaderComponent={() => <Text style={styles.listHeader}>All Areas</Text>}
      ListEmptyComponent={() => <View style={styles.center}><Text style={styles.noDataText}>No areas found.</Text></View>}
    />
  );
}

// --- SCREEN 3: STORE LIST ---
function StoreListScreen({ route, navigation }) {
  const { area } = route.params;
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [storesList, setStoresList] = useState([]);

  useEffect(() => {
    const fetchStores = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/stores?area=${area}`);
        const json = await response.json();
        setStoresList(json);
      } catch (e) { setError(e); } 
      finally { setIsLoading(false); }
    };
    fetchStores();
  }, [area]);

  const renderStoreItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.itemContainer}
      onPress={() => navigation.navigate('Store Dashboard', { 
        storeId: item.id, 
        storeName: item.name 
      })}
    >
      <View style={styles.itemDetails}>
        <Text style={styles.itemText}>{item.name}</Text>
      </View>
    </TouchableOpacity>
  );

  if (isLoading) return <View style={styles.center}><ActivityIndicator size="large" /><Text>Loading stores...</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.errorText}>Failed to fetch stores!</Text></View>;

  return (
    <FlatList
      data={storesList}
      renderItem={renderStoreItem}
      keyExtractor={item => item.id.toString()}
      ListHeaderComponent={() => <Text style={styles.listHeader}>Stores in {area}</Text>}
      ListEmptyComponent={() => <View style={styles.center}><Text style={styles.noDataText}>No stores found in this area.</Text></View>}
    />
  );
}

// --- SCREEN 4: STORE DETAIL DASHBOARD ---
function StoreDetailScreen({ route }) {
  const { storeId, storeName } = route.params;
  return (
    <View style={{flex: 1}}>
      <ReusableDashboard filter={{ store_id: storeId }} />
    </View>
  );
}

// --- SCREEN 5: ALERTS SCREEN (UPDATED) ---
function AlertsScreen() {
  const [isLoading, setIsLoading] = useState(true); // Set to true to load on open
  const [error, setError] = useState(null);
  const [alertsList, setAlertsList] = useState([]);
  const [resolvingId, setResolvingId] = useState(null);

  // --- UPDATED: Moved fetchAlerts out of useEffect ---
  const fetchAlerts = async () => {
    // Don't show loading spinner on background refresh
    // setIsLoading(true); 
    const thirtyDaysAgo = new Date(new Date().setDate(new Date().getDate() - 30));
    const startDate = formatDate(thirtyDaysAgo);
    const endDate = formatDate(new Date());

    try {
      const response = await fetch(`${API_BASE_URL}/v1/feedback?start=${startDate}&end=${endDate}&status=New`);
      const json = await response.json();
      const criticalAlerts = json.filter(item => item.sentiment === 'Negative');
      setAlertsList(criticalAlerts);
    } catch (e) {
      setError(e);
      console.error(e);
    } finally {
      setIsLoading(false); // Always stop loading
    }
  };

  // --- UPDATED: useEffect for loading and realtime ---
  useEffect(() => {
    // 1. Fetch data on load
    setIsLoading(true); // Show loader on first load
    fetchAlerts();

    // 2. Connect to the socket server
    const socket = io(API_BASE_URL);

    // 3. Listen for events
    socket.on('new_feedback', (data) => {
      console.log('New feedback received! Refreshing alerts...');
      fetchAlerts();
    });
    
    socket.on('feedback_resolved', (data) => {
      console.log(`Feedback ${data.id} resolved. Removing from alerts.`);
      setAlertsList(prevList => prevList.filter(item => item.id !== data.id));
    });
    
    // 4. Clean up
    return () => {
      socket.disconnect();
    };
  }, []); // Only run this once

  // --- handleResolve (No Change) ---
  const handleResolve = async (feedbackId) => {
    setResolvingId(feedbackId);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/feedback/${feedbackId}/resolve`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to resolve feedback');
      // The socket event will handle the UI update
    } catch (e) {
      setError(e);
      console.error(e);
    } finally {
      setResolvingId(null);
    }
  };

  // --- renderAlertItem (No Change) ---
  const renderAlertItem = ({ item }) => (
    <View style={styles.itemContainer}>
      <Text style={styles.itemText}>{item.text}</Text>
      <View style={styles.itemDetails}>
        <Text style={styles.itemCategory(item.category)}>{item.category}</Text>
        <Text style={styles.itemSentiment(item.sentiment)}>{item.sentiment}</Text>
      </View>
      <Text style={styles.itemTimestamp}>{new Date(item.timestamp).toLocaleString()}</Text>
      <TouchableOpacity
        style={styles.resolveButton}
        onPress={() => handleResolve(item.id)}
        disabled={resolvingId === item.id}
      >
        <Text style={styles.resolveButtonText}>
          {resolvingId === item.id ? "Resolving..." : "Mark as Resolved"}
        </Text>
      </TouchableOpacity>
    </View>
  );

  if (isLoading) return <View style={styles.center}><ActivityIndicator size="large" /><Text>Loading alerts...</Text></View>;
  if (error) return <View style={styles.center}><Text style={styles.errorText}>Failed to fetch alerts!</Text></View>;

  return (
    <FlatList
      data={alertsList}
      renderItem={renderAlertItem}
      keyExtractor={item => item.id.toString()}
      ListHeaderComponent={() => <Text style={styles.listHeader}>Critical Alerts (New, Last 30 Days)</Text>}
      ListEmptyComponent={() => (
        <View style={styles.center}>
          <Text style={styles.noDataText}>No negative feedback found in the last 30 days. 🎉</Text>
        </View>
      )}
    />
  );
}
// --- END ALERTS SCREEN ---


// ===================================================================
// --- 3. THE NAVIGATORS (No Changes) ---
// ===================================================================

const Tab = createMaterialTopTabNavigator();
const Stack = createStackNavigator();

function AreaNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Area List" component={AreaListScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Store List" component={StoreListScreen} options={({ route }) => ({ title: `Area: ${route.params.area}` })} />
      <Stack.Screen name="Store Dashboard" component={StoreDetailScreen} options={({ route }) => ({ title: route.params.storeName })} />
    </Stack.Navigator>
  );
}

// --- THE MAIN APP COMPONENT ---
export default function App() {
  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.mainHeader}>Feedback Dashboard</Text>
      
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            tabBarLabelStyle: { fontSize: 14, fontWeight: 'bold' },
            tabBarIndicatorStyle: { backgroundColor: '#007AFF' },
          }}
        >
          <Tab.Screen name="Dashboard" component={CorporateDashboardScreen} />
          <Tab.Screen name="Areas" component={AreaNavigator} />
          <Tab.Screen 
            name="Alerts"
            component={AlertsScreen} 
            options={{
              tabBarLabelStyle: { fontSize: 14, fontWeight: 'bold', color: 'red' }
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaView>
  );
}

// ===================================================================
// --- 4. THE STYLES (THIS IS THE MISSING PIECE) ---
// ===================================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: StatusBar.currentHeight || 0,
    backgroundColor: '#f5f5f5',
  },
  mainHeader: {
    fontSize: 24,
    fontWeight: 'bold',
    padding: 16,
    backgroundColor: 'white',
    textAlign: 'center',
  },
  center: {
    padding: 20,
    alignItems: 'center',
    marginTop: 20,
    justifyContent: 'center',
    flex: 1,
  },
  noDataText: {
    fontSize: 16,
    color: '#555',
    padding: 20,
    textAlign: 'center',
  },
  filterContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: 16,
    backgroundColor: 'white',
    alignItems: 'center',
  },
  datePickerContainer: {
    alignItems: 'center',
  },
  dateLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    backgroundColor: 'white',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  applyButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    flex: 1,
  },
  applyButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  exportButton: (disabled) => ({
    backgroundColor: disabled ? '#ccc' : '#6c757d',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: 'center',
    marginLeft: 10,
    textDecorationLine: 'none',
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
    pointerEvents: disabled ? 'none' : 'auto',
  }),
  metricsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    padding: 10,
    backgroundColor: 'white',
  },
  metricBox: {
    alignItems: 'center',
    padding: 10,
    minWidth: 100,
  },
  metricValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  metricLabel: {
    fontSize: 14,
    color: '#555',
    marginTop: 4,
  },
  chartContainer: {
    backgroundColor: 'white',
    padding: 16,
    margin: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  listHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 10,
  },
  itemContainer: {
    backgroundColor: 'white',
    padding: 16,
    marginVertical: 8,
    marginHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 8,
  },
  itemDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  itemCategory: (category) => ({
    fontSize: 14,
    fontWeight: 'bold',
    color: category === 'Quality of food' ? '#007AFF' : '#555',
  }),
  itemSentiment: (sentiment) => ({
    fontSize: 14,
    fontWeight: 'bold',
    color: sentiment === 'Positive' ? 'green' : sentiment === 'Negative' ? 'red' : 'orange',
  }),
  itemTimestamp: {
    fontSize: 12,
    color: 'gray',
    marginTop: 8,
  },
  itemArea: {
    fontSize: 14,
    color: 'gray',
  },
  errorText: {
    fontSize: 16,
    color: 'red',
    marginBottom: 8,
  },
  resolveButton: {
    backgroundColor: '#28a745',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 5,
    marginTop: 12,
    alignSelf: 'flex-start',
  },
  resolveButtonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 14,
  },
});