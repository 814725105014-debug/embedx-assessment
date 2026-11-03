/**
 * EMBEDX Workshop Quiz — Official 30-Question Bank
 * Source: EMBEDX_30_Question_Workshop_Quiz_with_Answers.pdf
 * EMBEDX | Embedded Systems & Automation Club — SRM TRP Engineering College
 */

export const DEFAULT_QUIZ_META = {
  quizId: 'embedx-workshop-2026',
  clubName: 'EMBEDX | Embedded Systems & Automation Club',
  departmentName: 'Department of Electrical and Electronics Engineering',
  collegeName: 'SRM TRP Engineering College',
  quizTitle: 'EMBEDX Workshop Assessment Quiz',
  workshopTitle: 'Basics of Embedded Systems and Embedded Programming Language',
  topicsSummary:
    'Embedded systems, Arduino, Embedded C, ESP32, basic sensors, actuators, and hardware–software integration.',
  totalQuestions: 30,
  defaultDurationMinutes: 30,
  maxWarnings: 2,
  returnCountdownSeconds: 20
};

export const DEFAULT_QUESTIONS = [
  // ================= Embedded Systems Basics (1-4) =================
  {
    id: 1,
    category: 'Embedded Systems Basics',
    type: 'mcq',
    question: 'What is the main purpose of an embedded system?',
    options: [
      'Perform a dedicated function within a larger device',
      'Replace every general-purpose computer',
      'Work only with internet connectivity',
      'Store unlimited data'
    ],
    correctIndex: 0,
    explanation: 'Embedded systems are designed to perform specific functions within products or equipment.'
  },
  {
    id: 2,
    category: 'Embedded Systems Basics',
    type: 'mcq',
    question: 'Which part of an embedded system usually executes the program?',
    options: [
      'Microcontroller or microprocessor',
      'Sensor casing',
      'Connector shell',
      'Heat sink only'
    ],
    correctIndex: 0,
    explanation: 'The processor executes instructions; other components support input, output, power, and thermal management.'
  },
  {
    id: 3,
    category: 'Embedded Systems Basics',
    type: 'mcq',
    question: 'What is firmware?',
    options: [
      'Software stored on or programmed into a device to control its operation',
      'A type of resistor',
      'A mechanical gear',
      'A computer monitor'
    ],
    correctIndex: 0,
    explanation: 'Firmware is low-level software that controls a device or its hardware functions.'
  },
  {
    id: 4,
    category: 'Embedded Systems Basics',
    type: 'mcq',
    question: 'Which component typically converts a physical quantity into an electrical signal?',
    options: [
      'Sensor',
      'Actuator',
      'Battery holder',
      'Fuse only'
    ],
    correctIndex: 0,
    explanation: 'Sensors detect physical quantities and produce signals that an embedded system can read.'
  },

  // ================= Arduino and Embedded C (5-10) =================
  {
    id: 5,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: 'Which board is commonly used for beginner embedded projects?',
    options: [
      'Arduino Uno',
      'Monitor',
      'Keyboard',
      'Router'
    ],
    correctIndex: 0,
    explanation: 'Arduino Uno is a widely used development board for learning and prototyping.'
  },
  {
    id: 6,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: 'In Arduino programming, which function runs once after the board starts?',
    options: [
      'loop()',
      'setup()',
      'repeat()',
      'beginLoop()'
    ],
    correctIndex: 1,
    explanation: 'setup() runs once at startup to initialize pins, communication, and other settings.'
  },
  {
    id: 7,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: "Which Arduino function configures a GPIO pin's mode?",
    options: [
      'digitalWrite()',
      'pinMode()',
      'analogRead()',
      'delay()'
    ],
    correctIndex: 1,
    explanation: 'pinMode() configures a pin as INPUT, OUTPUT, or a supported alternate mode.'
  },
  {
    id: 8,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: 'Which function sets a digital output pin HIGH or LOW?',
    options: [
      'digitalWrite()',
      'analogRead()',
      'pinMode()',
      'millis()'
    ],
    correctIndex: 0,
    explanation: 'digitalWrite() sets the logic state of a digital output pin.'
  },
  {
    id: 9,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: 'What does delay(1000) do in a typical Arduino sketch?',
    options: [
      'Wait approximately 1000 milliseconds',
      'Wait 1000 seconds',
      'Read an analog sensor',
      'Restart the board'
    ],
    correctIndex: 0,
    explanation: 'The delay argument is in milliseconds, so 1000 ms is about one second.'
  },
  {
    id: 10,
    category: 'Arduino and Embedded C',
    type: 'mcq',
    question: 'What is the purpose of Serial.begin(9600) in Arduino?',
    options: [
      'Initialize serial communication at 9600 baud',
      'Set a pin to output',
      'Turn on Wi-Fi',
      'Read a temperature sensor'
    ],
    correctIndex: 0,
    explanation: 'Serial.begin() configures the serial interface and its communication baud rate.'
  },

  // ================= ESP32 (11-14) =================
  {
    id: 11,
    category: 'ESP32',
    type: 'mcq',
    question: 'Which microcontroller family is used by the classic ESP32 DevKit V1?',
    options: [
      'ATmega328P',
      'ESP32',
      '8051',
      'PIC16F877A'
    ],
    correctIndex: 1,
    explanation: 'The classic ESP32 DevKit V1 uses an ESP32-series chip.'
  },
  {
    id: 12,
    category: 'ESP32',
    type: 'mcq',
    question: 'Which wireless features are available on many ESP32 variants?',
    options: [
      'Wi-Fi and Bluetooth',
      'FM radio and NFC only',
      'Infrared only',
      'No wireless features'
    ],
    correctIndex: 0,
    explanation: 'Many ESP32 variants include Wi-Fi and Bluetooth; exact Bluetooth support depends on the chip variant.'
  },
  {
    id: 13,
    category: 'ESP32',
    type: 'mcq',
    question: 'What is GPIO?',
    options: [
      'General-Purpose Input/Output',
      'Global Program Internet Option',
      'Graphic Processor Input Output',
      'Ground Power Interface Output'
    ],
    correctIndex: 0,
    explanation: 'GPIO pins can be configured to read digital inputs or drive digital outputs.'
  },
  {
    id: 14,
    category: 'ESP32',
    type: 'mcq',
    question: 'Why should ESP32 GPIO voltage limits be checked before connecting a module?',
    options: [
      'To avoid damaging the pins with incompatible voltage levels',
      'To increase memory',
      'To change the programming language',
      'To improve the antenna color'
    ],
    correctIndex: 0,
    explanation: 'ESP32 pins are not generally 5 V tolerant; signal levels must be compatible with the device.'
  },

  // ================= Sensors and Actuators (15-20) =================
  {
    id: 15,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'Which sensor commonly measures temperature and relative humidity?',
    options: [
      'DHT11',
      'HC-SR04',
      'PIR',
      'LDR'
    ],
    correctIndex: 0,
    explanation: 'DHT11 measures temperature and humidity.'
  },
  {
    id: 16,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'The HC-SR04 measures distance using which principle?',
    options: [
      'Ultrasonic echo travel time',
      'Magnetic field strength',
      'Visible light color',
      'Air pressure'
    ],
    correctIndex: 0,
    explanation: 'It measures the time taken for an ultrasonic pulse to return as an echo.'
  },
  {
    id: 17,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'What does a PIR sensor commonly detect?',
    options: [
      'Motion through changes in infrared radiation',
      'Water pH',
      'Distance using sound',
      'Electrical current directly'
    ],
    correctIndex: 0,
    explanation: 'PIR sensors detect changes in infrared energy, often from moving people or animals.'
  },
  {
    id: 18,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'An LDR changes its resistance mainly in response to what?',
    options: [
      'Light intensity',
      'Sound frequency',
      'Humidity only',
      'Magnetic polarity'
    ],
    correctIndex: 0,
    explanation: "An LDR's resistance typically decreases as incident light increases."
  },
  {
    id: 19,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'Which component performs a physical action in response to a control signal?',
    options: [
      'Actuator',
      'Sensor',
      'Compiler',
      'Pull-up resistor'
    ],
    correctIndex: 0,
    explanation: 'Actuators convert control signals into actions such as motion, switching, or sound.'
  },
  {
    id: 20,
    category: 'Sensors and Actuators',
    type: 'mcq',
    question: 'A relay is commonly used to:',
    options: [
      'Switch a separate electrical load using a control signal',
      'Measure humidity',
      'Store program code',
      'Detect ultrasonic echoes'
    ],
    correctIndex: 0,
    explanation: 'A relay provides electrically controlled switching; load and coil ratings must be respected.'
  },

  // ================= Hardware-Software Integration (21-26) =================
  {
    id: 21,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'Why is a common GND connection important between a microcontroller and a sensor?',
    options: [
      'It provides a shared voltage reference',
      'It increases processor clock speed',
      'It converts code into firmware',
      'It replaces the power supply'
    ],
    correctIndex: 0,
    explanation: 'A shared ground gives signal voltages a common reference.'
  },
  {
    id: 22,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'Which interface uses SDA and SCL lines?',
    options: [
      'I²C',
      'UART',
      'SPI',
      'PWM'
    ],
    correctIndex: 0,
    explanation: 'I²C uses the serial data (SDA) and serial clock (SCL) lines.'
  },
  {
    id: 23,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'Which interface typically uses TX and RX for asynchronous serial communication?',
    options: [
      'UART',
      'I²C',
      'SPI',
      'ADC'
    ],
    correctIndex: 0,
    explanation: 'UART sends and receives serial data using transmit and receive lines.'
  },
  {
    id: 24,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'In SPI, which signal commonly selects a peripheral device?',
    options: [
      'CS/SS',
      'SDA',
      'SCL',
      'RX only'
    ],
    correctIndex: 0,
    explanation: 'Chip Select or Slave Select identifies which SPI peripheral is active.'
  },
  {
    id: 25,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'What is the purpose of an ADC in a microcontroller?',
    options: [
      'Convert an analog voltage into a digital value',
      'Convert source code into machine code',
      'Drive a motor mechanically',
      'Store Wi-Fi credentials'
    ],
    correctIndex: 0,
    explanation: 'An Analog-to-Digital Converter samples an analog signal and represents it digitally.'
  },
  {
    id: 26,
    category: 'Hardware–Software Integration',
    type: 'mcq',
    question: 'Why might a motor require a driver circuit instead of being connected directly to a GPIO pin?',
    options: [
      'The motor may need more current or voltage than the pin can safely provide',
      'GPIO pins cannot run software',
      'Motors only work with sensors',
      'A driver removes the need for power'
    ],
    correctIndex: 0,
    explanation: 'A motor driver handles suitable current and voltage and may provide direction or speed control.'
  },

  // ================= Practical Concepts (27-30) =================
  {
    id: 27,
    category: 'Practical Concepts',
    type: 'mcq',
    question: 'What does PWM commonly allow a microcontroller to control?',
    options: [
      'Average power delivered, such as LED brightness or motor speed',
      'The physical size of a sensor',
      "The program's file name",
      'The USB connector type'
    ],
    correctIndex: 0,
    explanation: 'Pulse-width modulation varies duty cycle to control average delivered power.'
  },
  {
    id: 28,
    category: 'Practical Concepts',
    type: 'tf',
    question: 'True or False: A sensor is an output device that directly performs the control action.',
    options: [
      'True',
      'False'
    ],
    correctIndex: 1,
    explanation: 'A sensor provides measurements as input; an actuator performs an output action.'
  },
  {
    id: 29,
    category: 'Practical Concepts',
    type: 'tf',
    question: 'True or False: Many ESP32 variants support Wi-Fi, and Bluetooth capability depends on the particular variant.',
    options: [
      'True',
      'False'
    ],
    correctIndex: 0,
    explanation: 'ESP32 families offer different wireless capabilities; check the exact chip specification.'
  },
  {
    id: 30,
    category: 'Practical Concepts',
    type: 'tf',
    question: 'True or False: JPEG is a standard serial communication interface used between microcontrollers and sensors.',
    options: [
      'True',
      'False'
    ],
    correctIndex: 1,
    explanation: 'JPEG is an image compression format, not a serial hardware communication interface.'
  }
];
