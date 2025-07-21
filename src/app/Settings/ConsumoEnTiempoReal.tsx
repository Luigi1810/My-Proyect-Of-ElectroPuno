import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Dimensions, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from 'C:/Users/amigo/Downloads/PROYECTO PYTHON/PROYECTOS CON REACT NATIVE/MyApp/src/utils/ThemeContext';
import BackButton from 'C:/Users/amigo/Downloads/PROYECTO PYTHON/PROYECTOS CON REACT NATIVE/MyApp/src/utils/BackButton';
import { LineChart } from 'react-native-chart-kit';
import { useRouter } from 'expo-router';
import { useLanguage } from 'C:/Users/amigo/Downloads/PROYECTO PYTHON/PROYECTOS CON REACT NATIVE/MyApp/src/utils/LanguageContext';

interface EnergyData { //luiouoiuouoi
  voltage: number;
  current: number;
  power: number;
  energy: number;
  power_factor: number;
  frequency: number;
  timestamp: string;
  device_id: string;
}

// Configuración de gráficos
const CHART_CONFIG = {
  backgroundColor: 'transparent',
  backgroundGradientFrom: 'transparent',
  backgroundGradientTo: 'transparent',
  decimalPlaces: 2,
  color: (opacity = 1) => `rgba(0, 122, 255, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(0, 0, 0, ${opacity})`,
  propsForDots: {
    r: '4',
    strokeWidth: '2',
    stroke: '#007aff'
  }
};

const DARK_CHART_CONFIG = {
  ...CHART_CONFIG,
  color: (opacity = 1) => `rgba(100, 210, 255, ${opacity})`,
  labelColor: (opacity = 1) => `rgba(255, 255, 255, ${opacity})`,
};

const ConsumoEnTiempoReal = () => {
  const { theme } = useTheme();
  const router = useRouter();
  const { t } = useLanguage();
  const [currentData, setCurrentData] = useState<EnergyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [history, setHistory] = useState<EnergyData[]>([]);
  const API_BASE_URL = 'http://192.168.1.7:5000';
  const REQUEST_TIMEOUT = 30000; // 30 segundos
  // ID del dispositivo real en InfluxDB (basado en la imagen)
  const DEVICE_ID = 'ESP32_EnergyMonitor';
  const MAX_HISTORY = 50; // Reducido para mejor rendimiento
  const REFRESH_INTERVAL = 5000; // 5 segundos

  // --- FUNCIONES PARA MANEJAR JWT ---
  const obtenerToken = async (): Promise<string> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: 'admin',
          password: 'secret'
        })
      });
      
      if (!response.ok) {
        throw new Error(`Error de autenticación: ${response.status}`);
      }
      
      const data = await response.json();
      return data.token;
    } catch (error) {
      console.error('Error al obtener token:', error);
      throw error;
    }
  };

  const guardarToken = async (token: string) => {
    await AsyncStorage.setItem('jwt_token', token);
  };

  const cargarToken = async (): Promise<string | null> => {
    return await AsyncStorage.getItem('jwt_token');
  };

  const fetchWithRetry = async (url: string | Request, options = {}, retries = 3) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeout);
      if (retries > 0) {
        console.log(`Retrying... (${retries} attempts left)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return fetchWithRetry(url, options, retries - 1);
      }
      throw error;
    }
  };

  // Función principal para obtener datos en tiempo real desde InfluxDB
  const fetchRealtimeData = async () => {
    try {
      setError(null);
      
      let token = await cargarToken();
      if (!token) {
        token = await obtenerToken();
        await guardarToken(token);
      }

      const data = await fetchWithRetry(
        `${API_BASE_URL}/api/energy/${DEVICE_ID}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );

      // Validar que los datos recibidos tienen la estructura correcta
      if (data && typeof data === 'object') {
        // Crear objeto de datos con valores por defecto si faltan campos
        const energyData: EnergyData = {
          voltage: Number(data.voltage) || 0,
          current: Number(data.current) || 0,
          power: Number(data.power) || 0,
          energy: Number(data.energy) || 0,
          power_factor: Number(data.power_factor) || 0,
          frequency: Number(data.frequency) || 50,
          timestamp: data.timestamp || new Date().toISOString(),
          device_id: data.device_id || DEVICE_ID
        };

        setCurrentData(energyData);
        setConnected(true);
        setLoading(false);

        // Actualizar historial
        setHistory(prevHistory => {
          const newHistory = [...prevHistory, energyData];
          return newHistory.slice(-MAX_HISTORY); // Mantener solo los últimos MAX_HISTORY elementos
        });

        console.log('Datos recibidos correctamente:', energyData);
      } else {
        throw new Error('Datos recibidos no tienen el formato esperado');
      }

    } catch (error: any) {
      console.error('Error completo:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      setConnected(false);
      setLoading(false);
      
      // Manejar diferentes tipos de errores
      if (error.message.includes('Network request failed')) {
        setError('Error de conexión con el servidor. Verificar que el servidor Flask esté ejecutándose.');
      } else if (error.message.includes('401')) {
        setError('Error de autenticación. Verificar credenciales.');
        // Limpiar token inválido
        await AsyncStorage.removeItem('jwt_token');
      } else if (error.message.includes('404')) {
        setError('Endpoint no encontrado. Verificar configuración del servidor.');
      } else {
        setError(`Error: ${error.message}`);
      }
    }
  };

  // Efecto para actualización periódica
  useEffect(() => {
    const interval = setInterval(() => {
      fetchRealtimeData();
    }, REFRESH_INTERVAL);

    // Llamada inicial
    fetchRealtimeData();

    return () => clearInterval(interval);
  }, []);

  // Preparar datos para gráficos
  const prepareChartData = (key: keyof EnergyData) => {
    if (key === 'timestamp' || key === 'device_id') return { labels: [], datasets: [{ data: [] }] };
    
    const data = history.map(item => Number(item[key]) || 0);
    const labels = history.map((_, i) => (i % 10 === 0 ? i.toString() : ''));
    
    return {
      labels,
      datasets: [
        {
          data: data.length > 0 ? data : [0],
          color: (opacity = 1) => 
            theme === 'dark' ? `rgba(100, 210, 255, ${opacity})` : `rgba(0, 122, 255, ${opacity})`,
          strokeWidth: 2
        }
      ],
    };
  };

  // Calcular costo estimado en tiempo real
  const calculateCurrentCost = () => {
    if (!currentData || !currentData.energy) return '0.0000';
    
    const currentHour = new Date().getHours();
    const isPeakHour = currentHour >= 18 && currentHour < 22;
    const rate = isPeakHour ? 0.18 : 0.13; // PEN/kWh
    
    return (currentData.energy * rate).toFixed(4);
  };

  // Función auxiliar para mostrar valores seguros
  const safeValue = (value: number | undefined, decimals: number = 2, defaultValue: number = 0): string => {
    return (value !== undefined && value !== null ? Number(value) : defaultValue).toFixed(decimals);
  };

  if (loading && !connected) {
    return (
      <View style={[styles.container, { backgroundColor: theme === 'dark' ? '#121212' : '#f5f5f5' }]}>
        <View style={styles.header}>
          <BackButton onPress={() => router.back()} tintColor={theme === 'dark' ? '#fff' : '#000'} />
          <Text style={[styles.headerTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Consumo en Tiempo Real')}
          </Text>
        </View>
        <ActivityIndicator style={styles.Loading} size="large" color={theme === 'dark' ? '#fff' : '#000'} />
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#fff' : '#000' }]}>
          {t('Conectando con InfluxDB...')}
        </Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          {t('Obteniendo datos del dispositivo ESP32_EnergyMonitor')}
        </Text>
      </View>
    );
  }

  if (error && !currentData) {
    return (
      <View style={[styles.container, { backgroundColor: theme === 'dark' ? '#121212' : '#f5f5f5' }]}>
        <View style={styles.header}>
          <BackButton onPress={() => router.back()} tintColor={theme === 'dark' ? '#fff' : '#000'} />
          <Text style={[styles.headerTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Consumo en Tiempo Real')}
          </Text>
        </View>
        <Text style={[styles.errorText, { color: theme === 'dark' ? '#ff6b6b' : '#d9534f' }]}>{error}</Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          {t('Verificar:')}
        </Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          • {t('Servidor Flask ejecutándose en puerto 5000')}
        </Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          • {t('InfluxDB conectado y con datos')}
        </Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          • {t('Dispositivo ESP32_EnergyMonitor enviando datos')}
        </Text>
        <Text style={[styles.statusText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          • {t('Red WiFi conectada correctamente')}
        </Text>
      </View>
    );
  }

  const chartConfig = theme === 'dark' ? DARK_CHART_CONFIG : CHART_CONFIG;
  const screenWidth = Dimensions.get('window').width - 40;

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme === 'dark' ? '#121212' : '#f5f5f5' }]}>
      <View style={styles.header}>
        <BackButton onPress={() => router.back()} tintColor={theme === 'dark' ? '#fff' : '#000'} />
        <Text style={[styles.headerTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
          {t('Consumo en Tiempo Real')}
        </Text>
      </View>
      
      <Text style={[styles.title, { color: theme === 'dark' ? '#fff' : '#000' }]}>
        {t('Monitor de Energía - InfluxDB')}
      </Text>
      
      {/* Datos actuales */}
      <View style={[styles.currentDataContainer, { backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)' }]}>
        <Text style={[styles.sectionTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
          {t('Mediciones Actuales')}
        </Text>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Voltaje')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.voltage, 2)} V
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Corriente')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.current, 2)} A
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Potencia')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.power, 2)} W
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Energía')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.energy, 3)} kWh
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Factor de Potencia')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.power_factor, 2)}
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Frecuencia')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#4fc3f7' : '#1976d2' }]}>
            {safeValue(currentData?.frequency, 1, 50)} Hz
          </Text>
        </View>
        
        <View style={styles.dataItem}>
          <Text style={[styles.dataLabel, { color: theme === 'dark' ? '#fff' : '#000' }]}>{t('Costo Actual')}:</Text>
          <Text style={[styles.dataValue, { color: theme === 'dark' ? '#81c784' : '#388e3c' }]}>
            S/ {calculateCurrentCost()}
          </Text>
        </View>
      </View>

      {/* Gráficos de tendencias */}
      {history.length > 1 && (
        <View style={styles.chartsContainer}>
          <Text style={[styles.sectionTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Tendencias en Tiempo Real')}
          </Text>
          
          <Text style={[styles.chartTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Voltaje (V)')}
          </Text>
          <LineChart
            data={prepareChartData('voltage')}
            width={screenWidth}
            height={180}
            yAxisSuffix=" V"
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
          
          <Text style={[styles.chartTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Corriente (A)')}
          </Text>
          <LineChart
            data={prepareChartData('current')}
            width={screenWidth}
            height={180}
            yAxisSuffix=" A"
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
          
          <Text style={[styles.chartTitle, { color: theme === 'dark' ? '#fff' : '#000' }]}>
            {t('Potencia (W)')}
          </Text>
          <LineChart
            data={prepareChartData('power')}
            width={screenWidth}
            height={180}
            yAxisSuffix=" W"
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </View>
      )}
      
      {/* Estado de conexión */}
      <View style={styles.statusContainer}>
        {connected ? (
          <>
            <Text style={[styles.statusText, { color: theme === 'dark' ? '#4caf50' : '#2e7d32' }]}>
              ✅ {t('Conectado a InfluxDB')}
            </Text>
            <Text style={[styles.statusText, { color: theme === 'dark' ? '#4caf50' : '#2e7d32' }]}>
              📊 {t('Datos en tiempo real desde bucket "Datos_de_energia"')}
            </Text>
            <Text style={[styles.statusText, { color: theme === 'dark' ? '#4caf50' : '#2e7d32' }]}>
              🔌 {t('Dispositivo: ESP32_EnergyMonitor')}
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.statusText, { color: theme === 'dark' ? '#ff6b6b' : '#d9534f' }]}>
              ❌ {t('Desconectado de InfluxDB')}
            </Text>
            <Text style={[styles.statusText, { color: theme === 'dark' ? '#ff6b6b' : '#d9534f' }]}>
              ⚠️ {t('Verificar servidor Flask y configuración')}
            </Text>
          </>
        )}
        
        {currentData && currentData.timestamp && (
          <Text style={[styles.timestampText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
            {t('Última actualización')}: {new Date(currentData.timestamp).toLocaleTimeString()}
          </Text>
        )}
        
        <Text style={[styles.timestampText, { color: theme === 'dark' ? '#ccc' : '#666' }]}>
          {t('Actualización automática cada 5 segundos')}
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 15,
  },
  Loading: {
    paddingTop: 200
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  currentDataContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 15,
    padding: 20,
  },
  chartsContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    paddingTop: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 16,
  },
  dataItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  dataLabel: {
    fontSize: 16,
    fontWeight: '500',
  },
  dataValue: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 50,
    marginBottom: 20,
    marginHorizontal: 20,
  },
  statusContainer: {
    marginHorizontal: 20,
    marginBottom: 30,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 5,
  },
  timestampText: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
  },
  chartTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
  },
  chart: {
    borderRadius: 10,
    marginBottom: 10,
  },
});

export default ConsumoEnTiempoReal;

